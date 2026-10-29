/** Web preview only: browsers have no keychain, so use localStorage. */
export const secureStorage = {
  get: async (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: async (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private mode); the session then lasts until reload.
    }
  },
  remove: async (key: string) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};
