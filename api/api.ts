import axios from "axios";
import { API_DEV, API_PROD, API_USERNAME, API_PASSWORD } from "@env";

const rawBase = __DEV__ ? API_DEV : API_PROD;
const baseURL = rawBase?.replace(/\/+$/, "");

// Build a Basic auth header if credentials are provided in .env
const makeAuthHeader = () => {
  if (!API_USERNAME || !API_PASSWORD) return undefined;

  const toEncode = `${API_USERNAME}:${API_PASSWORD}`;
  // Prefer btoa (available in React Native); fall back to Buffer/manual encode.
  const encoded =
    typeof globalThis.btoa === "function"
      ? globalThis.btoa(toEncode)
      : (() => {
          const buf = (globalThis as any)?.Buffer;
          if (buf?.from) return buf.from(toEncode, "binary").toString("base64");
          // Simple manual base64 as a last resort
          const chars =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
          let output = "";
          let i = 0;
          while (i < toEncode.length) {
            const c1 = toEncode.charCodeAt(i++);
            const c2 = toEncode.charCodeAt(i++);
            const c3 = toEncode.charCodeAt(i++);
            const b1 = c1 >> 2;
            const b2 = ((c1 & 3) << 4) | (c2 >> 4);
            const b3 = ((c2 & 15) << 2) | (c3 >> 6);
            const b4 = c3 & 63;
            if (Number.isNaN(c2)) {
              output += `${chars[b1]}${chars[b2]}==`;
            } else if (Number.isNaN(c3)) {
              output += `${chars[b1]}${chars[b2]}${chars[b3]}=`;
            } else {
              output += `${chars[b1]}${chars[b2]}${chars[b3]}${chars[b4]}`;
            }
          }
          return output;
        })();

  if (!encoded) return undefined;
  return `Basic ${encoded}`;
};

export const authHeader = makeAuthHeader();

export default axios.create({
  baseURL,
  headers: authHeader ? { Authorization: authHeader } : undefined,
});
