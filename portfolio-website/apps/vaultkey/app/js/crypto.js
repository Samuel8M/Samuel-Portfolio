/**
 * VaultKey demo - crypto layer.
 *
 * This file talks to the browser's native Web Crypto API (`crypto.subtle`
 * and `crypto.getRandomValues`) only. There is no hand-rolled cipher or KDF
 * math here, no crypto library, no CDN dependency -- exactly like the real
 * VaultKey CLI (see `vaultkey/crypto.py`), which also does not implement
 * any cipher/KDF math itself and only calls into a well-vetted library.
 *
 * --- Parity note: key derivation algorithm -----------------------------
 * The real VaultKey CLI (`vaultkey/crypto.py`) derives its AES key with
 * **scrypt** (N=2**15, r=8, p=1), a memory-hard KDF chosen specifically to
 * resist cheap GPU/ASIC brute-forcing. The W3C Web Crypto API's
 * `SubtleCrypto.deriveKey()` / `deriveBits()` does **not** implement scrypt
 * at all -- browsers only expose PBKDF2, HKDF and ECDH/X25519 for key
 * derivation -- so an exact algorithmic port to the browser is not
 * possible. This demo therefore uses **PBKDF2-HMAC-SHA256** with
 * 600,000 iterations (the current OWASP Password Storage Cheat Sheet
 * minimum recommendation for PBKDF2-SHA256) as the closest browser-native
 * stand-in for "deliberately slow, brute-force-resistant KDF". Every other
 * parameter below is a direct match to `vaultkey/crypto.py`:
 *   - SALT_SIZE  = 16 bytes (crypto.py: SALT_SIZE = 16), fresh per vault
 *   - NONCE_SIZE = 12 bytes (crypto.py: NONCE_SIZE = 12), fresh per encrypt
 *   - KEY_SIZE   = 32 bytes -> AES-256 (crypto.py: KEY_SIZE = 32)
 *   - Cipher     = AES-GCM, an AEAD: wrong key/AAD or tampered ciphertext
 *                  fails decryption loudly (DOMException "OperationError"
 *                  here, `cryptography.exceptions.InvalidTag` in Python)
 *                  instead of returning corrupted plaintext.
 *
 * --- Secure-context note ------------------------------------------------
 * `crypto.subtle` is only exposed in a "secure context". Modern Chromium
 * and Firefox treat `file://` documents as secure enough to expose it when
 * you open this file directly by double-clicking it, but that is a
 * browser-specific courtesy, not a guarantee from the spec -- some
 * browsers/configurations withhold `crypto.subtle` on plain `file://`
 * pages. `app.js` checks `window.crypto?.subtle` on load and shows an
 * explicit inline message instead of silently breaking if it is missing.
 * Served over http(s) (including the `file://` parent iframe embedding
 * this same-origin `file://` child in `../index.html`, or the real
 * portfolio site's https hosting) this is a non-issue.
 */

const VaultCrypto = (() => {
  'use strict';

  const SALT_SIZE = 16; // bytes, matches vaultkey/crypto.py SALT_SIZE
  const NONCE_SIZE = 12; // bytes, matches vaultkey/crypto.py NONCE_SIZE
  const KEY_LENGTH_BITS = 256; // AES-256, matches vaultkey/crypto.py KEY_SIZE = 32 bytes
  const PBKDF2_ITERATIONS = 600000; // OWASP minimum for PBKDF2-HMAC-SHA256 (2023 guidance)
  const PBKDF2_HASH = 'SHA-256';
  const FORMAT_VERSION = 1;

  function isAvailable() {
    return !!(window.crypto && window.crypto.subtle);
  }

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function generateSalt() {
    return randomBytes(SALT_SIZE);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Additional authenticated data binding a ciphertext to its envelope
   * (format version + salt), mirroring `vaultkey/vault.py`'s `_make_aad`.
   * This means a ciphertext copy-pasted into a different vault's
   * salt/version envelope also fails authentication, not just a wrong
   * password.
   */
  function makeAad(formatVersion, saltBytes) {
    const prefix = new TextEncoder().encode(`vaultkey-demo:v${formatVersion}:`);
    const out = new Uint8Array(prefix.length + saltBytes.length);
    out.set(prefix, 0);
    out.set(saltBytes, prefix.length);
    return out;
  }

  /**
   * Derive a 32-byte AES-256 key from a master password and salt via
   * PBKDF2-HMAC-SHA256 (see parity note at the top of this file).
   * Returns a non-extractable CryptoKey usable only for AES-GCM
   * encrypt/decrypt -- the raw key bytes never touch JS-land and are
   * never persisted, matching "nothing but the derived key lives only in
   * memory" from vaultkey/vault.py's Vault docstring.
   */
  async function deriveKey(password, saltBytes, iterations, hash) {
    if (typeof password !== 'string' || password === '') {
      throw new Error('password must be a non-empty string');
    }
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash },
      passwordKey,
      { name: 'AES-GCM', length: KEY_LENGTH_BITS },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt `plaintextBytes` under `key` with AES-256-GCM. Generates a
   * fresh random 12-byte nonce/IV per call (nonces must never be reused
   * with the same key) and returns { iv, ciphertext } as Uint8Arrays.
   * The GCM authentication tag is appended to the ciphertext by
   * SubtleCrypto automatically (tagLength: 128 bits, the AES-GCM default).
   */
  async function encrypt(key, plaintextBytes, aadBytes) {
    const iv = randomBytes(NONCE_SIZE);
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aadBytes, tagLength: 128 },
      key,
      plaintextBytes
    );
    return { iv, ciphertext: new Uint8Array(ciphertextBuffer) };
  }

  /**
   * Decrypt with AES-256-GCM, verifying the auth tag. On a wrong key
   * (wrong master password), wrong AAD, or tampered ciphertext, this
   * throws a DOMException named "OperationError" -- the browser
   * equivalent of the real project's `DecryptionError` -- and does NOT
   * return partial or corrupted plaintext.
   */
  async function decrypt(key, ivBytes, ciphertextBytes, aadBytes) {
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes, tagLength: 128 },
      key,
      ciphertextBytes
    );
    return new Uint8Array(plaintextBuffer);
  }

  return {
    SALT_SIZE,
    NONCE_SIZE,
    PBKDF2_ITERATIONS,
    PBKDF2_HASH,
    FORMAT_VERSION,
    isAvailable,
    randomBytes,
    generateSalt,
    bytesToBase64,
    base64ToBytes,
    bytesToHex,
    makeAad,
    deriveKey,
    encrypt,
    decrypt,
  };
})();
