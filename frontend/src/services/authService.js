/**
 * Authentication Service
 *
 * Handles all authentication-related API calls.
 * Currently uses MOCK data for development.
 * Will be replaced with real API calls when NestJS backend is built.
 *
 * Mock Users (any password works):
 * - admin@socio.lk    → admin role
 * - manager@socio.lk  → manager role
 * - cashier@socio.lk  → cashier role
 */

// ============================================
// MOCK DATABASE
// ============================================

const MOCK_USERS = {
  "admin@socio.lk": {
    id: 1,
    name: "Admin User",
    email: "admin@socio.lk",
    role: "admin",
    avatar: null,
  },
  "manager@socio.lk": {
    id: 2,
    name: "Manager User",
    email: "manager@socio.lk",
    role: "manager",
    avatar: null,
  },
  "cashier@socio.lk": {
    id: 3,
    name: "Cashier User",
    email: "cashier@socio.lk",
    role: "cashier",
    avatar: null,
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generates a mock JWT-like token
 *
 * Real JWT structure: header.payload.signature
 * Our mock structure: mockHeader.payload.mockSignature
 *
 * The payload is base64-encoded JSON (just like real JWT)
 * so we can decode it with jwt-decode library
 *
 * @param {Object} user - User data to embed in token
 * @returns {string} Mock JWT token
 */
const generateMockToken = (user) => {
  const header = btoa(JSON.stringify({ alg: "mock", typ: "JWT" }));

  const payload = btoa(
    JSON.stringify({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      iat: Math.floor(Date.now() / 1000), // Issued at
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // Expires in 24 hours
    }),
  );

  const signature = "mock-signature-not-real";

  return `${header}.${payload}.${signature}`;
};

/**
 * Simulates network delay (1 second)
 * Makes the mock feel realistic
 */
const simulateNetworkDelay = (ms = 1000) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// ============================================
// AUTH API METHODS
// ============================================

/**
 * Mock login function
 * Simulates an API call to authenticate user
 *
 * @param {Object} credentials - { email, password }
 * @returns {Promise<{ user, token }>} User data and auth token
 * @throws {Error} If credentials are invalid
 */
export const loginAPI = async ({ email, password }) => {
  // Simulate network delay
  await simulateNetworkDelay(1000);

  // Validate input
  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  // Find user in mock database
  const user = MOCK_USERS[email.toLowerCase()];

  // Simulate invalid credentials
  if (!user) {
    throw new Error("Invalid email or password");
  }

  // Mock password check (in real app, backend does this)
  // For now: any password with at least 3 characters works
  if (password.length < 3) {
    throw new Error("Password must be at least 3 characters");
  }

  // Generate mock token
  const token = generateMockToken(user);

  // Return user and token (mimics real API response)
  return {
    user,
    token,
  };
};

/**
 * Mock logout function
 * In a real app, this would call the backend to invalidate the token
 */
export const logoutAPI = async () => {
  await simulateNetworkDelay(300);
  return { success: true };
};

/**
 * Mock function to verify if a token is still valid
 * Used when restoring session from localStorage
 *
 * @param {string} token - JWT token
 * @returns {boolean} Whether token is valid
 */
export const isTokenValid = (token) => {
  if (!token) return false;

  try {
    // Extract and decode payload
    const payload = token.split(".")[1];
    if (!payload) return false;

    const decoded = JSON.parse(atob(payload));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    return decoded.exp > now;
  } catch (error) {
    console.error("Invalid token:", error);
    return false;
  }
};
