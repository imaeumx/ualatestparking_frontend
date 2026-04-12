import CryptoJS from 'crypto-js';

/**
 * DES utility used by the frontend.
 *
 * Notes:
 * - Uses one shared secret key from VITE_DES_SECRET_KEY.
 * - Encryption output is randomized by CryptoJS (salted format).
 * - Decryption fails gracefully and returns the original value.
 *
 * Security warning:
 * DES is legacy crypto and weak for real production security.
 * It is kept here for project/course constraints.
 */

// ============ SHARED SECRET KEY ============
// Use the same DES key from both frontend and backend .env files.
const DES_SECRET_KEY = import.meta.env.VITE_DES_SECRET_KEY;

/** Validate whether the provided key matches the configured DES key. */
export function isSystemDESKey(candidateKey) {
    return String(candidateKey || '').trim() === DES_SECRET_KEY;
}

/**
 * Encrypt any value using DES and return a ciphertext string.
 * Null/undefined inputs are normalized to empty string.
 */
export function encryptDES(plainText) {
    // Guard against null/undefined values (common in React state)
    // String(value) converts any value to string
    const normalizedValue = plainText == null ? '' : String(plainText);
    
    // Call CryptoJS library to encrypt
    // Input: value to encrypt, secret key (must match backend's key)
    // Output: encrypted object
    // .toString() converts encrypted object → readable string
    return CryptoJS.DES.encrypt(normalizedValue, DES_SECRET_KEY).toString();
}

/**
 * Decrypt ciphertext using the shared DES key.
 * Returns:
 * - empty string for empty input
 * - plaintext when decryption succeeds
 * - original input when decryption fails
 */
export function decryptDES(cipherText) {
    // Guard against null/undefined/empty inputs
    const normalizedValue = cipherText == null ? '' : String(cipherText);
    if (!normalizedValue) return '';

    try {
        const bytes = CryptoJS.DES.decrypt(normalizedValue, DES_SECRET_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted || normalizedValue;
    } catch {
        return normalizedValue;
    }
}

/** Generate a random DES-sized key (8 bytes) as base64. */
export function generateDESKey() {
    const randomWords = CryptoJS.lib.WordArray.random(8);
    return CryptoJS.enc.Base64.stringify(randomWords);
}

// Console helpers for admin operations in browser DevTools (F12).
if (typeof window !== 'undefined') {
    window.uaShowDESKey = () => DES_SECRET_KEY;
    window.uaGenerateDESKey = () => generateDESKey();
}
