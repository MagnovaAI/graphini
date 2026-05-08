/**
 * Lightweight tooltip action that mounts a single shared, theme-aware tooltip
 * pop-up next to the hovered element.  Used as a drop-in replacement for native
 * `title=""` so we don't have to wrap every interactive element in a
 * <Tooltip.Root> tree.
 *
 * Usage:
 *   <button use:tooltip={'Change node shape'}>…</button>
 *   <button use:tooltip={{ text: 'Top to Bottom', side: 'top' }}>…</button>
 */

type Side = 'top' | 'right' | 'bottom' | 'left';

interface TooltipOptions {
  text: string;
  side?: Side;
  delay?: number;
}

type TooltipParam = string | TooltipOptions | null | undefined;

const TOOLTIP_ID = '__graphini_tooltip__';
let tipEl: HTMLDivElement | null = null;
let labelEl: HTMLDivElement | null = null;
let arrowEl: HTMLDivElement | null = null;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let activeTarget: HTMLElement | null = null;
let activeSide: Side = 'top';

function ensureTipEl(): HTMLDivElement {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  const el = document.createElement('div');
  el.id = TOOLTIP_ID;
  el.setAttribute('role', 'tooltip');
  el.setAttribute(
    'style',
    [
      'position: fixed',
      'z-index: 100',
      'pointer-events: none',
      'opacity: 0',
      'transform: scale(0.95)',
      'transform-origin: center',
      'transition: opacity 120ms ease-out, transform 120ms ease-out',
      'will-change: transform, opacity'
    ].join('; ')
  );
  // Inner label — matches bits-ui Tooltip.Content classes
  const lbl = document.createElement('div');
  lbl.setAttribute(
    'style',
    [
      'position: relative',
      'display: inline-flex',
      'align-items: center',
      'border-radius: 6px',
      'padding: 6px 12px',
      'font-size: 12px',
      'line-height: 1',
      'font-weight: 500',
      'background-color: var(--foreground)',
      'color: var(--background)',
      'white-space: nowrap',
      'max-width: 320px'
    ].join('; ')
  );
  el.appendChild(lbl);
  // Arrow
  const arrow = document.createElement('div');
  arrow.setAttribute(
    'style',
    [
      'position: absolute',
      'width: 8px',
      'height: 8px',
      'background-color: var(--foreground)',
      'transform: rotate(45deg)',
      'border-radius: 1px'
    ].join('; ')
  );
  el.appendChild(arrow);
  document.body.appendChild(el);
  tipEl = el;
  labelEl = lbl;
  arrowEl = arrow;
  return el;
}

function hide(): void {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  activeTarget = null;
  if (!tipEl) return;
  tipEl.style.opacity = '0';
  tipEl.style.transform = 'scale(0.95)';
}

function position(target: HTMLElement, side: Side): void {
  if (!tipEl || !arrowEl) return;
  const rect = target.getBoundingClientRect();
  const tip = tipEl.getBoundingClientRect();
  const gap = 6;
  let left = 0;
  let top = 0;
  switch (side) {
    case 'top':
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.top - tip.height - gap;
      break;
    case 'bottom':
      left = rect.left + rect.width / 2 - tip.width / 2;
      top = rect.bottom + gap;
      break;
    case 'left':
      left = rect.left - tip.width - gap;
      top = rect.top + rect.height / 2 - tip.height / 2;
      break;
    case 'right':
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - tip.height / 2;
      break;
  }
  // Clamp tooltip horizontally to viewport but remember the shift so the arrow
  // can stay aligned with the trigger.
  const pad = 4;
  const desiredLeft = left;
  const desiredTop = top;
  left = Math.max(pad, Math.min(left, window.innerWidth - tip.width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - tip.height - pad));
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;

  // Position arrow against the side facing the trigger, centered on it.
  const triggerCenterX = rect.left + rect.width / 2;
  const triggerCenterY = rect.top + rect.height / 2;
  const arrowSize = 8;
  switch (side) {
    case 'top':
      arrowEl.style.left = `${Math.round(triggerCenterX - left - arrowSize / 2)}px`;
      arrowEl.style.top = `${Math.round(tip.height - arrowSize / 2)}px`;
      break;
    case 'bottom':
      arrowEl.style.left = `${Math.round(triggerCenterX - left - arrowSize / 2)}px`;
      arrowEl.style.top = `${Math.round(-arrowSize / 2)}px`;
      break;
    case 'left':
      arrowEl.style.left = `${Math.round(tip.width - arrowSize / 2)}px`;
      arrowEl.style.top = `${Math.round(triggerCenterY - top - arrowSize / 2)}px`;
      break;
    case 'right':
      arrowEl.style.left = `${Math.round(-arrowSize / 2)}px`;
      arrowEl.style.top = `${Math.round(triggerCenterY - top - arrowSize / 2)}px`;
      break;
  }
  // Avoid unused-variable warnings when both desired equal final.
  void desiredLeft;
  void desiredTop;
}

function show(target: HTMLElement, opts: TooltipOptions): void {
  const el = ensureTipEl();
  if (labelEl) labelEl.textContent = opts.text;
  activeSide = opts.side ?? 'top';
  // Hidden state until positioned, otherwise it flashes at 0,0.
  el.style.opacity = '0';
  el.style.transform = 'scale(0.95)';
  // Pre-position with current dimensions, then re-position after paint.
  position(target, activeSide);
  requestAnimationFrame(() => {
    if (activeTarget !== target) return;
    position(target, activeSide);
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  });
}

function normalize(param: TooltipParam): TooltipOptions | null {
  if (!param) return null;
  if (typeof param === 'string') return { text: param };
  if (!param.text) return null;
  return param;
}

export function tooltip(node: HTMLElement, param: TooltipParam) {
  let opts = normalize(param);

  function onEnter() {
    if (!opts) return;
    activeTarget = node;
    if (openTimer) clearTimeout(openTimer);
    const delay = opts.delay ?? 200;
    openTimer = setTimeout(() => {
      if (!opts || activeTarget !== node) return;
      show(node, opts);
    }, delay);
  }

  function onLeave() {
    if (activeTarget === node) hide();
  }

  function onFocusIn() {
    if (!opts) return;
    activeTarget = node;
    show(node, opts);
  }

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('focusin', onFocusIn);
  node.addEventListener('focusout', onLeave);
  // Hide if button is clicked (so it doesn't linger over a now-different UI).
  node.addEventListener('click', onLeave);

  return {
    update(next: TooltipParam) {
      opts = normalize(next);
      if (!opts) hide();
    },
    destroy() {
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onLeave);
      node.removeEventListener('click', onLeave);
      if (activeTarget === node) hide();
    }
  };
}
