/**
 * Client-side Auth Store
 * Manages user session state, login/logout, and credits
 */

import { syncPreferencesFromServer } from '$lib/client/stores/panels.svelte';
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

interface AuthUser {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  is_guest?: boolean;
}

interface CreditInfo {
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
}

interface AuthState {
  user: AuthUser | null;
  credits: CreditInfo | null;
  loading: boolean;
  initialized: boolean;
}

const AUTH_CACHE_KEY = 'graphini_auth_cache';

function loadCachedAuth(): { user: AuthUser | null; credits: CreditInfo | null } {
  try {
    if (typeof localStorage === 'undefined') return { user: null, credits: null };
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.user) return { user: cached.user, credits: cached.credits || null };
    }
  } catch {
    /* localStorage unavailable */
  }
  return { user: null, credits: null };
}

function saveCachedAuth(user: AuthUser | null, credits: CreditInfo | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (user) {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ user, credits }));
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    /* localStorage unavailable */
  }
}

// Hydrate immediately from cache for instant UI
const cached = loadCachedAuth();

const state = $state<AuthState>(
  hmrRestore('authState') ?? {
    user: cached.user,
    credits: cached.credits,
    loading: false,
    initialized: cached.user !== null
  }
);
hmrPreserve('authState', () => ({ ...state }));

async function fetchMe(): Promise<void> {
  try {
    state.loading = true;
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      state.credits = data.credits;
      saveCachedAuth(data.user, data.credits);
      // Sync preferences from server after auth check
      if (state.user)
        syncPreferencesFromServer().catch(() => {
          /* silent */
        });
    } else {
      state.user = null;
      state.credits = null;
      saveCachedAuth(null, null);
    }
  } catch {
    state.user = null;
    state.credits = null;
    saveCachedAuth(null, null);
  } finally {
    state.loading = false;
    state.initialized = true;
  }
}

/**
 * OAuth login — redirect directly to magnova-auth (same pattern as Astrova)
 */
const AUTH_URL = 'https://auth.magnova.ai';

function login(returnTo?: string): void {
  const redirect = returnTo || `${window.location.origin}/app`;
  window.location.href = `${AUTH_URL}/graphini?redirect=${encodeURIComponent(redirect)}`;
}

/**
 * Local login — email + password (sets graphini_session cookie)
 */
async function loginLocal(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    state.loading = true;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.user) {
      state.user = data.user;
      saveCachedAuth(data.user, null);
      state.initialized = true;
      // Fetch full user + credits
      await fetchMe();
      return { success: true };
    }
    return { success: false, error: data.error || 'Login failed' };
  } catch {
    return { success: false, error: 'Network error' };
  } finally {
    state.loading = false;
  }
}

/**
 * Local registration — email + password + optional display name
 */
async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    state.loading = true;
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, displayName })
    });
    const data = await res.json();
    if (res.ok && data.user) {
      state.user = data.user;
      saveCachedAuth(data.user, null);
      state.initialized = true;
      await fetchMe();
      return { success: true };
    }
    return { success: false, error: data.error || 'Registration failed' };
  } catch {
    return { success: false, error: 'Network error' };
  } finally {
    state.loading = false;
  }
}

function logout(): void {
  state.user = null;
  state.credits = null;
  saveCachedAuth(null, null);
  // Clear local session cookie by setting expired
  document.cookie = 'graphini_session=; Path=/; Max-Age=0';
  window.location.href = '/api/auth/logout';
}

async function refreshCredits(): Promise<void> {
  try {
    const res = await fetch('/api/credits', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      state.credits = data.balance;
      saveCachedAuth(state.user, state.credits);
    }
  } catch {
    /* ignore */
  }
}

export const authStore = {
  get credits() {
    return state.credits;
  },
  get hasSession() {
    return !!state.user;
  },
  init: fetchMe,
  get isGuest() {
    return !!state.user && state.user.is_guest === true;
  },
  get isInitialized() {
    return state.initialized;
  },
  get isLoading() {
    return state.loading;
  },
  get isLoggedIn() {
    return !!state.user && state.user.is_guest !== true;
  },
  /**
   * True when there is *any* identity attached (real user OR guest cookie).
   * Use this to gate DB persistence — guests get to persist too, just inside
   * their own quota.
   */
  get hasIdentity() {
    return !!state.user;
  },
  login,
  loginLocal,
  logout,
  refreshCredits,
  register,
  get state() {
    return state;
  },
  get user() {
    return state.user;
  }
};
