export const ACTIVE_CLIENT_STORAGE_KEY = 'sightfull:active-client-id';

const canUseBrowserStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const getStoredActiveClientId = (): string | null => {
  if (!canUseBrowserStorage()) return null;
  try {
    const value = window.localStorage.getItem(ACTIVE_CLIENT_STORAGE_KEY);
    const normalized = String(value ?? '').trim();
    return normalized || null;
  } catch {
    return null;
  }
};

export const setStoredActiveClientId = (clientId: string | null | undefined) => {
  if (!canUseBrowserStorage()) return;
  try {
    const normalized = String(clientId ?? '').trim();
    if (normalized) {
      window.localStorage.setItem(ACTIVE_CLIENT_STORAGE_KEY, normalized);
      return;
    }
    window.localStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
  } catch {
    // Ignore storage errors in locked-down browser contexts.
  }
};

export const clearStoredActiveClientId = () => {
  setStoredActiveClientId(null);
};

export const buildActiveClientHeaders = (clientId = getStoredActiveClientId()) => {
  return clientId ? { 'x-active-client-id': clientId } : {};
};
