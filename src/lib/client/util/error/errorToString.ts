/**
 * Safely convert any error value to a string for display in toasts/UI
 * Handles Error objects, SvelteKit errors, plain objects, and other types
 */
export function errorToString(error: unknown, defaultMessage = 'An error occurred'): string {
  if (error instanceof Error) {
    return error.message || defaultMessage;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    // Handle SvelteKit error objects
    if ('message' in error) {
      return String(error.message) || defaultMessage;
    }
    if ('detail' in error) {
      return String(error.detail) || defaultMessage;
    }

    // Try to stringify the object
    try {
      const stringified = JSON.stringify(error);
      // If it's just an empty object or unhelpful, use default
      if (stringified === '{}' || stringified.length < 3) {
        return defaultMessage;
      }
      return stringified;
    } catch {
      // Can't stringify, use default
      return defaultMessage;
    }
  }

  return String(error || defaultMessage);
}
