import CryptoJS from 'crypto-js';

/**
 * ============================================================
 * DES Encryption/Decryption Utility Module
 * ============================================================
 * 
 * PURPOSE:
 * Centralized location for all DES encryption/decryption operations.
 * Instead of duplicating CryptoJS calls across StickerManagement, UserDashboard, AdminPanel,
 * we have ONE source of truth here.
 * 
 * WHY WE ENCRYPT:
 * - Protect sensitive data (plate numbers, owner names) if backend database is compromised
 * - Satisfy security requirements for university parking system
 * - Demonstrate understanding of encryption concepts
 * 
 * SECURITY DISCLAIMER:
 * DES (Data Encryption Standard) is deprecated and considered weak by modern standards.
 * - Uses 56-bit keys (too small by today's standards, can be cracked with enough computing power)
 * - Better alternatives: AES-256 (in production), RSA (for key exchange)
 * - We use DES here for EDUCATIONAL PURPOSES only (course learning)
 * - Should NOT be used for protecting real financial/medical data
 * 
 * SYMMETRIC ENCRYPTION:
 * - One key for both encryption AND decryption
 * - Fast, simple, good for proof-of-concept
 * - Downside: key must be kept secret on both frontend and backend
 * - If key is leaked, all encrypted data can be decrypted
 * 
 * How it works in this project:
 * 1. User submits sticker app with plate \"ABC1234\"
 * 2. StickerManagement calls encryptDES(\"ABC1234\") → returns gibberish like \"$sDf#1@8kX9$mL2#\"
 * 3. Frontend POSTs encrypted value to backend
 * 4. Backend stores encrypted value in database
 * 5. When admin/user views records, backend returns encrypted value
 * 6. Frontend calls decryptDES(\"$sDf#1@8kX9$mL2#\") → returns \"ABC1234\" for display
 */

// ============ SHARED SECRET KEY ============
// Environment variable override: if VITE_DES_SECRET_KEY is defined in .env, use that.
// Otherwise, fallback to hardcoded key (not ideal for production, but ok for learning).
// Key must be IDENTICAL on frontend and backend, or decryption will fail.
const DES_SECRET_KEY = import.meta.env.VITE_DES_SECRET_KEY || 'UA-SECRET-KEY';

/**
 * FUNCTION: encryptDES
 * 
 * Convert plain text into encrypted gibberish using DES algorithm.
 * 
 * INPUT: plainText (any string or value)
 * OUTPUT: encrypted string (e.g., "U2FsdGVkX1...kX9jM=")
 * 
 * USAGE EXAMPLES:
 * - StickerManagement: encryptDES(\"ABC1234\") before submitting vehicle application
 * - UserDashboard: encryptDES(user.name) before sending to backend
 * 
 * IMPLEMENTATION NOTES:
 * - CryptoJS.DES.encrypt() is the CryptoJS library function
 * - .toString() converts the encrypted object to a string
 * - Normalization (null/undefined → '') prevents encryption crashes
 * 
 * WHY NORMALIZE INPUTS:
 * - If plainText is null or undefined, CryptoJS.DES.encrypt() might fail
 * - Instead, convert null/undefined to empty string ''
 * - Empty string encrypts fine and decrypts back to ''
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
 * FUNCTION: decryptDES
 * 
 * Convert encrypted gibberish back into readable plain text.
 * Reverse operation of encryptDES().
 * 
 * INPUT: cipherText (encrypted string, e.g., "U2FsdGVkX1...kX9jM=")
 * OUTPUT: decrypted string (e.g., "ABC1234") or original value if decryption fails
 * 
 * USAGE EXAMPLES:
 * - StickerManagement table: decryptDES(record.plate_number) when rendering
 * - AdminPanel: decryptDES(application.plateNumber) to show actual plate
 * 
 * WHY FALLBACK ON ERROR:
 * - If frontend and backend have different keys, decryption returns garbage
 * - If data is corrupted or plain text (not encrypted), decryption fails
 * - Instead of crashing the page, return the original value
 * - User sees \"$sDf#1@8\" instead of nothing (less ideal but safe)
 * 
 * RETURN VALUE:
 * - Empty string if cipherText is empty/null
 * - Decrypted text if successful
 * - Original cipherText if decryption fails (graceful degradation)
 */
export function decryptDES(cipherText) {
    // Guard against null/undefined/empty inputs
    const normalizedValue = cipherText == null ? '' : String(cipherText);
    if (!normalizedValue) return ''; // Empty input → empty output

    try {
        // Call CryptoJS library to decrypt
        // Input: encrypted text, secret key (MUST match the encryption key)
        // Output: decrypted bytes
        const bytes = CryptoJS.DES.decrypt(normalizedValue, DES_SECRET_KEY);
        
        // Convert decrypted bytes back to readable UTF-8 string
        // CryptoJS.enc.Utf8 specifies the character encoding (UTF-8 = standard text encoding)
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        
        // Return decrypted value if non-empty, otherwise return original input
        // (in case decryption produced empty string, treat as failure → return original)
        return decrypted || normalizedValue;
    } catch {
        // Decryption failed (corrupted data, key mismatch, etc.)
        // Return original value instead of crashing
        // This prevents white-screen errors in table rendering
        return normalizedValue;
    }
}
