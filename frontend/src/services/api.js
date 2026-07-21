import axios from "axios";

/**
 * Axios instance for talking to the SOCIO.LK POS backend.
 *
 * Key config:
 * - baseURL from env (single place to swap dev/prod)
 * - withCredentials: true so the browser sends/receives httpOnly cookies
 *   (access_token + refresh_token). Without this, cookies won't work.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;
