/**
 * localStorage Utility
 *
 * Centralized helper for managing browser localStorage.
 * All auth-related localStorage operations go through this file.
 *
 * Why a utility?
 * - Single source of truth for storage keys
 * - Easy to migrate to cookies later
 * - Type-safe operations
 * - Error handling in one place
 */

// ============================================
// STORAGE KEYS
// ============================================

const STORAGE_KEYS = {
  TOKEN: "socio_token",
  USER: "socio_user",
};

// ============================================
// CORE STORAGE FUNCTIONS
// ============================================

/**
 * Safely set an item in localStorage
 * Handles JSON stringification automatically
 */
const setItem = (key, value) => {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.error(`Failed to save to localStorage: ${key}`, error);
    return false;
  }
};

/**
 * Safely get an item from localStorage
 * Handles JSON parsing automatically
 */
const getItem = (key) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error(`Failed to read from localStorage: ${key}`, error);
    return null;
  }
};

/**
 * Remove a specific item from localStorage
 */
const removeItem = (key) => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`Failed to remove from localStorage: ${key}`, error);
    return false;
  }
};

// ============================================
// AUTH-SPECIFIC FUNCTIONS
// ============================================

export const storage = {
  /**
   * Save authentication data to localStorage
   * @param {Object} authData - { user, token }
   */
  setAuth: ({ user, token }) => {
    setItem(STORAGE_KEYS.USER, user);
    setItem(STORAGE_KEYS.TOKEN, token);
  },

  /**
   * Get saved auth data from localStorage
   * @returns {Object|null} { user, token } or null
   */
  getAuth: () => {
    const user = getItem(STORAGE_KEYS.USER);
    const token = getItem(STORAGE_KEYS.TOKEN);

    if (!user || !token) return null;
    return { user, token };
  },

  /**
   * Clear all auth data from localStorage
   * Used on logout
   */
  clearAuth: () => {
    removeItem(STORAGE_KEYS.USER);
    removeItem(STORAGE_KEYS.TOKEN);
  },

  /**
   * Get only the token (useful for API requests)
   */
  getToken: () => getItem(STORAGE_KEYS.TOKEN),

  /**
   * Check if user has saved credentials
   */
  hasAuth: () => {
    return !!(getItem(STORAGE_KEYS.TOKEN) && getItem(STORAGE_KEYS.USER));
  },
};

export default storage;
