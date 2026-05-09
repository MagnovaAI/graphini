/**
 * Guest account limits. Kept in one place so server enforcement and any
 * UI hint that surfaces them stay in sync.
 */

/** Maximum conversations a guest user can have at once. Inserts beyond this fail with 402. */
export const GUEST_CONVERSATION_LIMIT = 15;

/** Maximum conversations a signed-in user can have at once. Inserts beyond this fail with 409. */
export const USER_CONVERSATION_LIMIT = 30;

/** How long after last activity a guest user is considered abandoned and pruned. */
export const GUEST_INACTIVITY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
