/**
 * Per-session in-memory mirrors used by chat utilities that need cross-call
 * state within a single turn.
 */
export const memoryStore = new Map<string, string>();
export const planStore = new Map<string, string>();
