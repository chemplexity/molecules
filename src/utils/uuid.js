/** @module utils/uuid */

/**
 * Generates a UUID using Web Crypto in Node.js and supported browsers.
 * @returns {string} A random version 4 UUID.
 */
export function randomUUID() {
  return globalThis.crypto.randomUUID();
}
