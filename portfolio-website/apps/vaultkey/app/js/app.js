/**
 * VaultKey demo - UI wiring. No framework, no build step.
 */
(function () {
  'use strict';

  function $(id) {
    return document.getElementById(id);
  }

  function show(el) {
    el.hidden = false;
  }
  function hide(el) {
    el.hidden = true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // --- Secure-context / crypto.subtle availability check -------------
    // See the long comment at the top of js/crypto.js: crypto.subtle is
    // only guaranteed in a secure context. Fail loudly and helpfully
    // instead of letting every button silently throw.
    if (!VaultCrypto.isAvailable()) {
      hide($('app-root'));
      show($('subtle-unavailable'));
      return;
    }
    show($('app-root'));

    const els = {
      authError: $('auth-error'),
      authTitle: $('auth-title'),
      authSubtitle: $('auth-subtitle'),
      authForm: $('auth-form'),
      authPassword: $('auth-password'),
      authConfirmRow: $('auth-confirm-row'),
      authConfirm: $('auth-confirm'),
      authSubmit: $('auth-submit'),
      resetLink: $('reset-link'),
      lockScreen: $('lock-screen'),
      vaultScreen: $('vault-screen'),
      lockBtn: $('lock-btn'),
      entryList: $('entry-list'),
      emptyState: $('empty-state'),
      addForm: $('add-form'),
      addLabel: $('add-label'),
      addSecret: $('add-secret'),
      addError: $('add-error'),
      saltDisplay: $('salt-display'),
      kdfDisplay: $('kdf-display'),
      wrongPasswordHint: $('wrong-password-hint'),
    };

    let mode = 'create'; // 'create' | 'unlock'

    function renderAuthScreen() {
      const existing = VaultDemo.hasStoredVault();
      mode = existing ? 'unlock' : 'create';
      els.authTitle.textContent = existing ? 'Unlock your vault' : 'Create a new vault';
      els.authSubtitle.textContent = existing
        ? 'Enter your master password to derive the AES key and decrypt the verifier blob.'
        : 'Choose a master password. A random 16-byte salt is generated for this vault and a PBKDF2 key is derived from it -- nothing is sent anywhere, it all happens in this tab.';
      els.authConfirmRow.hidden = existing;
      els.authSubmit.textContent = existing ? 'Unlock' : 'Create vault';
      els.resetLink.hidden = !existing;
      els.wrongPasswordHint.hidden = !existing;
      els.authError.hidden = true;
      els.authPassword.value = '';
      els.authConfirm.value = '';
      show(els.lockScreen);
      hide(els.vaultScreen);
      els.authPassword.focus();
    }

    function renderVaultScreen() {
      hide(els.lockScreen);
      show(els.vaultScreen);
      renderEntries();
    }

    function renderEntries() {
      const entries = VaultDemo.getEntries();
      els.entryList.innerHTML = '';
      els.emptyState.hidden = entries.length !== 0;
      entries
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((entry) => {
          els.entryList.appendChild(renderEntryRow(entry));
        });
    }

    function renderEntryRow(entry) {
      const row = document.createElement('li');
      row.className = 'entry';
      row.dataset.id = entry.id;

      const main = document.createElement('div');
      main.className = 'entry-main';

      const label = document.createElement('div');
      label.className = 'entry-label';
      label.textContent = entry.label;

      const cipher = document.createElement('div');
      cipher.className = 'entry-cipher';
      cipher.textContent = `iv:${entry.iv.slice(0, 10)}… ct:${entry.ciphertext.slice(0, 22)}…`;
      cipher.title = `Full ciphertext (base64): ${entry.ciphertext}`;

      main.appendChild(label);
      main.appendChild(cipher);

      const revealBox = document.createElement('div');
      revealBox.className = 'entry-secret';
      revealBox.hidden = true;

      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      const revealBtn = document.createElement('button');
      revealBtn.type = 'button';
      revealBtn.className = 'ghost';
      revealBtn.textContent = 'Reveal';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'ghost danger';
      deleteBtn.textContent = 'Delete';

      revealBtn.addEventListener('click', async () => {
        if (!revealBox.hidden) {
          revealBox.hidden = true;
          revealBox.textContent = '';
          revealBtn.textContent = 'Reveal';
          return;
        }
        revealBtn.disabled = true;
        try {
          const plaintext = await VaultDemo.decryptEntry(entry.id);
          revealBox.textContent = plaintext;
          revealBox.hidden = false;
          revealBtn.textContent = 'Hide';
        } catch (err) {
          revealBox.textContent = err.message || String(err);
          revealBox.classList.add('error');
          revealBox.hidden = false;
        } finally {
          revealBtn.disabled = false;
        }
      });

      deleteBtn.addEventListener('click', () => {
        VaultDemo.removeEntry(entry.id);
        renderEntries();
      });

      actions.appendChild(revealBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(main);
      row.appendChild(revealBox);
      row.appendChild(actions);
      return row;
    }

    function updateMetaDisplay(saltHex, kdfParams) {
      if (saltHex) {
        els.saltDisplay.textContent = saltHex;
      }
      if (kdfParams) {
        els.kdfDisplay.textContent = `PBKDF2-HMAC-${kdfParams.hash.replace('SHA-', 'SHA')} · ${kdfParams.iterations.toLocaleString()} iterations`;
      }
    }

    els.authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      els.authError.hidden = true;
      const password = els.authPassword.value;

      els.authSubmit.disabled = true;
      try {
        if (mode === 'create') {
          if (password.length === 0) {
            throw new Error('Master password cannot be empty.');
          }
          if (password !== els.authConfirm.value) {
            throw new Error('Passwords do not match.');
          }
          await VaultDemo.create(password);
        } else {
          await VaultDemo.unlock(password);
        }
        const meta = VaultDemo.getMeta();
        if (meta) {
          updateMetaDisplay(meta.saltHex, meta.kdfParams);
        }
        renderVaultScreen();
      } catch (err) {
        els.authError.textContent = err.message || String(err);
        els.authError.hidden = false;
      } finally {
        els.authSubmit.disabled = false;
      }
    });

    els.resetLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (!confirm('This deletes the demo vault stored in this browser (localStorage). Continue?')) {
        return;
      }
      VaultDemo.reset();
      renderAuthScreen();
    });

    els.lockBtn.addEventListener('click', () => {
      VaultDemo.lock();
      renderAuthScreen();
    });

    els.addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      els.addError.hidden = true;
      try {
        await VaultDemo.addEntry(els.addLabel.value.trim(), els.addSecret.value);
        els.addLabel.value = '';
        els.addSecret.value = '';
        els.addLabel.focus();
        renderEntries();
      } catch (err) {
        els.addError.textContent = err.message || String(err);
        els.addError.hidden = false;
      }
    });

    renderAuthScreen();
  });
})();
