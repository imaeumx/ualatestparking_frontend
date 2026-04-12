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

const WORD_SIZE_BYTES = 4;
const DES_BLOCK_SIZE_BYTES = 8;

function safeBase64ToWordArray(value) {
    try {
        return CryptoJS.enc.Base64.parse(String(value || '').trim());
    } catch {
        return null;
    }
}

function wordArrayToUint8Array(wordArray) {
    if (!wordArray || typeof wordArray.sigBytes !== 'number') {
        return new Uint8Array();
    }

    const { words, sigBytes } = wordArray;
    const bytes = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i += 1) {
        const word = words[Math.floor(i / WORD_SIZE_BYTES)] || 0;
        bytes[i] = (word >>> (24 - (i % WORD_SIZE_BYTES) * 8)) & 0xff;
    }
    return bytes;
}

function uint8ArrayToWordArray(bytes) {
    const words = [];
    for (let i = 0; i < bytes.length; i += 1) {
        words[Math.floor(i / WORD_SIZE_BYTES)] |= bytes[i] << (24 - (i % WORD_SIZE_BYTES) * 8);
    }
    return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function getBackendCompatibleKeyWordArray(secretKey) {
    const rawKey = String(secretKey || '').trim();
    if (!rawKey) {
        return CryptoJS.enc.Utf8.parse('UA-KEY-1');
    }

    let keyBytes = null;
    const parsedBase64 = safeBase64ToWordArray(rawKey);
    if (parsedBase64) {
        const parsedBytes = wordArrayToUint8Array(parsedBase64);
        const normalizedRoundTrip = CryptoJS.enc.Base64.stringify(parsedBase64).replace(/=+$/, '');
        const rawNoPad = rawKey.replace(/=+$/, '');
        if (normalizedRoundTrip === rawNoPad) {
            keyBytes = parsedBytes;
        }
    }

    if (!keyBytes || keyBytes.length === 0) {
        keyBytes = new TextEncoder().encode(rawKey);
    }

    if (keyBytes.length < DES_BLOCK_SIZE_BYTES) {
        const padded = new Uint8Array(DES_BLOCK_SIZE_BYTES);
        padded.set(keyBytes.slice(0, keyBytes.length));
        const zeroByte = '0'.charCodeAt(0);
        for (let i = keyBytes.length; i < DES_BLOCK_SIZE_BYTES; i += 1) {
            padded[i] = zeroByte;
        }
        keyBytes = padded;
    } else {
        keyBytes = keyBytes.slice(0, DES_BLOCK_SIZE_BYTES);
    }

    return uint8ArrayToWordArray(keyBytes);
}

function getKeyCandidates(secretKey) {
    const raw = String(secretKey ?? '');
    const trimmed = raw.trim();
    const candidates = [raw, trimmed, `${trimmed}\n`, `${trimmed}\r\n`, `${trimmed} `];
    return [...new Set(candidates.filter((value) => value.length > 0))];
}

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
    const keyToUse = arguments.length > 1 ? arguments[1] : DES_SECRET_KEY;
    // Guard against null/undefined/empty inputs
    const normalizedValue = cipherText == null ? '' : String(cipherText);
    if (!normalizedValue) return '';

    // Try backend-compatible DES-CBC payload: base64([8-byte IV][ciphertext...]).
    try {
        const payload = safeBase64ToWordArray(normalizedValue);
        if (payload && payload.sigBytes > DES_BLOCK_SIZE_BYTES) {
            const payloadBytes = wordArrayToUint8Array(payload);
            const ivBytes = payloadBytes.slice(0, DES_BLOCK_SIZE_BYTES);
            const cipherBytes = payloadBytes.slice(DES_BLOCK_SIZE_BYTES);

            const decryptedWordArray = CryptoJS.DES.decrypt(
                { ciphertext: uint8ArrayToWordArray(cipherBytes) },
                getBackendCompatibleKeyWordArray(keyToUse),
                {
                    iv: uint8ArrayToWordArray(ivBytes),
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                }
            );
            const plaintext = decryptedWordArray.toString(CryptoJS.enc.Utf8);
            if (plaintext) return plaintext;
        }
    } catch {
        // Fall through to legacy decrypt format.
    }

    // Legacy fallback: CryptoJS passphrase-based format used by old frontend rows.
    for (const candidateKey of getKeyCandidates(keyToUse)) {
        try {
            const bytes = CryptoJS.DES.decrypt(normalizedValue, candidateKey);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            if (decrypted) return decrypted;
        } catch {
            // Try next candidate key variant.
        }
    }

    return normalizedValue;
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
