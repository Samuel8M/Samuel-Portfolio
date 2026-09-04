/**
 * VaultKey demo - in-memory vault state + optional localStorage persistence.
 *
 * Mirrors the shape of `vaultkey/vault.py`'s Vault: an "unlocked" vault
 * holds a derived key and entries in memory only; a "locked" vault forgets
 * the key entirely and can only show ciphertext until re-unlocked with the
 * master password. Just like the real vault file format's cleartext
 * envelope (format_version, kdf, kdf_params, salt, nonce, ciphertext),
 * everything persisted here is either non-secret metadata or ciphertext --
 * the master password and the derived key are NEVER written to
 * localStorage, only ever held in a JS variable for the current session.
 *
 * Because encryption happens per-entry in this demo (label + secret value,
 * per the assignment) rather than as one whole-vault blob like the Python
 * CLI, a fresh vault also encrypts a small "verifier" plaintext at
 * creation time. This gives an always-present ciphertext to
 * authenticate-decrypt against when unlocking, exactly so a wrong master
 * password fails loudly and immediately (see `unlock()` below) even
 * before any real entries exist -- reproducing the same user-visible
 * behavior as `Vault.open()` raising `VaultAuthError` in the CLI.
 */

const VaultDemo = (() => {
  'use strict';

  const STORAGE_KEY = 'vaultkey-demo-vault-v1';
  const VERIFIER_PLAINTEXT = 'vaultkey-demo-verifier';

  /** @type {{unlocked:boolean, key:CryptoKey|null, salt:Uint8Array|null, kdfParams:object|null, verifier:object|null, entries:Array}} */
  let state = freshState();

  function freshState() {
    return {
      unlocked: false,
      key: null,
      salt: null,
      kdfParams: null,
      verifier: null, // { iv: base64, ciphertext: base64 }
      entries: [], // [{ id, label, iv: base64, ciphertext: base64, createdAt }]
    };
  }

  function hasStoredVault() {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  function readStoredVault() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function persist() {
    const onDisk = {
      formatVersion: VaultCrypto.FORMAT_VERSION,
      kdf: 'PBKDF2',
      kdfParams: state.kdfParams,
      salt: VaultCrypto.bytesToBase64(state.salt),
      verifier: state.verifier,
      entries: state.entries,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(onDisk));
  }

  function isUnlocked() {
    return state.unlocked;
  }

  /** Non-secret display info for the current session (salt hex + KDF params). */
  function getMeta() {
    if (!state.salt) return null;
    return { saltHex: VaultCrypto.bytesToHex(state.salt), kdfParams: state.kdfParams };
  }

  function getEntries() {
    // Return shallow copies; callers only ever see label + ciphertext here,
    // never plaintext (decryption is always an explicit, separate call).
    return state.entries.map((e) => ({ ...e }));
  }

  /**
   * Create a brand-new in-memory vault: fresh random salt, PBKDF2-derived
   * key, and an encrypted verifier blob so future unlock attempts have
   * something to authenticate against. Equivalent to `Vault.create()`.
   */
  async function create(masterPassword) {
    if (hasStoredVault()) {
      throw new Error('A vault already exists in this browser. Unlock it or reset it first.');
    }
    const salt = VaultCrypto.generateSalt();
    const kdfParams = {
      name: 'PBKDF2',
      hash: VaultCrypto.PBKDF2_HASH,
      iterations: VaultCrypto.PBKDF2_ITERATIONS,
    };
    const key = await VaultCrypto.deriveKey(masterPassword, salt, kdfParams.iterations, kdfParams.hash);

    const aad = VaultCrypto.makeAad(VaultCrypto.FORMAT_VERSION, salt);
    const { iv, ciphertext } = await VaultCrypto.encrypt(
      key,
      new TextEncoder().encode(VERIFIER_PLAINTEXT),
      aad
    );

    state = {
      unlocked: true,
      key,
      salt,
      kdfParams,
      verifier: { iv: VaultCrypto.bytesToBase64(iv), ciphertext: VaultCrypto.bytesToBase64(ciphertext) },
      entries: [],
    };
    persist();
    return { salt: VaultCrypto.bytesToHex(salt), kdfParams };
  }

  /**
   * Unlock an existing (persisted) vault. Always *derives* a key from
   * whatever password is supplied -- PBKDF2 cannot tell a "wrong"
   * password from a "right" one by itself -- then attempts to decrypt the
   * stored verifier blob. Only that decrypt attempt reveals whether the
   * password was correct, exactly like AES-GCM's authenticated failure in
   * `vaultkey/crypto.py`. On failure this throws; the vault stays locked
   * and no derived key is retained.
   */
  async function unlock(masterPassword) {
    const stored = readStoredVault();
    if (!stored) {
      throw new Error('No vault found in this browser yet. Create one first.');
    }
    const salt = VaultCrypto.base64ToBytes(stored.salt);
    const key = await VaultCrypto.deriveKey(
      masterPassword,
      salt,
      stored.kdfParams.iterations,
      stored.kdfParams.hash
    );
    const aad = VaultCrypto.makeAad(stored.formatVersion, salt);

    try {
      await VaultCrypto.decrypt(
        key,
        VaultCrypto.base64ToBytes(stored.verifier.iv),
        VaultCrypto.base64ToBytes(stored.verifier.ciphertext),
        aad
      );
    } catch (err) {
      // AES-GCM tag verification failed: wrong master password (or a
      // corrupted/tampered vault). Deliberately generic message, same
      // spirit as vaultkey.crypto.DecryptionError -- callers should not
      // be able to distinguish "wrong password" from "corrupted data".
      throw new DecryptionError(
        'Decryption failed: incorrect master password or corrupted vault data.'
      );
    }

    state = {
      unlocked: true,
      key,
      salt,
      kdfParams: stored.kdfParams,
      verifier: stored.verifier,
      entries: stored.entries || [],
    };
    return true;
  }

  /** Forget the derived key and lock the vault. Ciphertext stays visible. */
  function lock() {
    state.unlocked = false;
    state.key = null;
  }

  /** Wipe the demo vault entirely (both in-memory and localStorage). */
  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    state = freshState();
  }

  /**
   * Encrypt + store a new entry (label + secret value) under the current
   * session key, with a fresh random IV. Equivalent to `Vault.add_entry()`
   * + `Vault.save()`.
   */
  async function addEntry(label, secretValue) {
    if (!state.unlocked || !state.key) {
      throw new Error('Vault is locked.');
    }
    if (!label) {
      throw new Error('Label cannot be empty.');
    }
    const aad = VaultCrypto.makeAad(VaultCrypto.FORMAT_VERSION, state.salt);
    const { iv, ciphertext } = await VaultCrypto.encrypt(
      state.key,
      new TextEncoder().encode(secretValue),
      aad
    );
    const entry = {
      id: (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      iv: VaultCrypto.bytesToBase64(iv),
      ciphertext: VaultCrypto.bytesToBase64(ciphertext),
      createdAt: Date.now(),
    };
    state.entries.push(entry);
    persist();
    return { ...entry };
  }

  function removeEntry(id) {
    if (!state.unlocked) {
      throw new Error('Vault is locked.');
    }
    state.entries = state.entries.filter((e) => e.id !== id);
    persist();
  }

  /**
   * Decrypt one entry's secret value on demand. Throws DecryptionError on
   * auth failure (should only happen if the vault/localStorage data was
   * hand-edited/corrupted, since a correct session key is required to be
   * unlocked at all).
   */
  async function decryptEntry(id) {
    if (!state.unlocked || !state.key) {
      throw new Error('Vault is locked.');
    }
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) {
      throw new Error('Entry not found.');
    }
    const aad = VaultCrypto.makeAad(VaultCrypto.FORMAT_VERSION, state.salt);
    try {
      const plaintext = await VaultCrypto.decrypt(
        state.key,
        VaultCrypto.base64ToBytes(entry.iv),
        VaultCrypto.base64ToBytes(entry.ciphertext),
        aad
      );
      return new TextDecoder().decode(plaintext);
    } catch (err) {
      throw new DecryptionError('Decryption failed: incorrect master password or corrupted vault data.');
    }
  }

  return {
    hasStoredVault,
    isUnlocked,
    getMeta,
    getEntries,
    create,
    unlock,
    lock,
    reset,
    addEntry,
    removeEntry,
    decryptEntry,
  };
})();

/**
 * Deliberately generic error, mirroring `vaultkey.crypto.DecryptionError`:
 * callers/UI should not try to distinguish "wrong password" from
 * "corrupted data" from the exception itself.
 */
class DecryptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecryptionError';
  }
}
