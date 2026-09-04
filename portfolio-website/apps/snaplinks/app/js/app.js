'use strict';

(function () {
  const service = window.SnapLinks.createLinkService();

  const createForm = document.getElementById('create-form');
  const urlInput = document.getElementById('url');
  const slugInput = document.getElementById('slug');
  const createError = document.getElementById('create-error');
  const createResult = document.getElementById('create-result');
  const resultSlug = document.getElementById('result-slug');
  const resultTarget = document.getElementById('result-target');

  const linkCount = document.getElementById('link-count');
  const emptyState = document.getElementById('empty-state');
  const linkList = document.getElementById('link-list');
  const resetBtn = document.getElementById('reset-btn');

  const statsCard = document.getElementById('stats-card');
  const statsSlug = document.getElementById('stats-slug');
  const statsClose = document.getElementById('stats-close');
  const statTarget = document.getElementById('stat-target');
  const statCreated = document.getElementById('stat-created');
  const statCount = document.getElementById('stat-count');
  const statTimeline = document.getElementById('stat-timeline');

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);

  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
  }
  function hideError(el) {
    el.hidden = true;
    el.textContent = '';
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- create form -------------------------------------------------

  createForm.addEventListener('submit', (event) => {
    event.preventDefault();
    hideError(createError);
    createResult.hidden = true;

    const url = urlInput.value.trim();
    const slug = slugInput.value.trim();

    try {
      const link = service.createLink({ url, slug: slug || undefined });
      resultSlug.textContent = link.slug;
      resultTarget.textContent = link.targetUrl;
      createResult.hidden = false;
      createForm.reset();
      renderLinkList();
      showToast(`Created "${link.slug}"`);
    } catch (err) {
      showError(createError, err.message || 'Something went wrong.');
    }
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('Clear all demo links and stats stored in this browser?')) return;
    service.resetAll();
    createResult.hidden = true;
    closeStats();
    renderLinkList();
    showToast('Demo data cleared');
  });

  // ---- link list -----------------------------------------------------

  function renderLinkList() {
    const links = service.listLinks();
    linkCount.textContent = links.length ? `(${links.length})` : '';
    emptyState.hidden = links.length !== 0;
    linkList.innerHTML = '';

    for (const link of links) {
      const li = document.createElement('li');
      li.className = 'link-row';
      li.innerHTML = `
        <span class="slug mono">/${escapeHtml(link.slug)}</span>
        <span class="target">${escapeHtml(link.targetUrl)}</span>
        <span class="count mono">${link.clickCount} click${link.clickCount === 1 ? '' : 's'}</span>
        <span class="actions">
          <button type="button" class="btn ghost small" data-action="visit" data-slug="${escapeHtml(link.slug)}">Visit</button>
          <button type="button" class="btn ghost small" data-action="stats" data-slug="${escapeHtml(link.slug)}">Stats</button>
          <button type="button" class="btn ghost small danger" data-action="delete" data-slug="${escapeHtml(link.slug)}">Delete</button>
        </span>
      `;
      linkList.appendChild(li);
    }
  }

  linkList.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const slug = btn.dataset.slug;
    const action = btn.dataset.action;

    if (action === 'visit') {
      const link = service.recordClick(slug);
      showToast(`Simulated visit recorded — would redirect to ${link.targetUrl}`);
      renderLinkList();
      if (!statsCard.hidden && statsSlug.dataset.slug === slug) {
        renderStats(slug);
      }
    } else if (action === 'stats') {
      renderStats(slug);
    } else if (action === 'delete') {
      if (!confirm(`Delete link "/${slug}"?`)) return;
      service.deleteLink(slug);
      if (!statsCard.hidden && statsSlug.dataset.slug === slug) {
        closeStats();
      }
      renderLinkList();
    }
  });

  // ---- stats panel ----------------------------------------------------

  function renderStats(slug) {
    let stats;
    try {
      stats = service.getStats(slug);
    } catch (err) {
      showToast(err.message || 'Could not load stats.');
      return;
    }

    statsSlug.textContent = `/${stats.slug}`;
    statsSlug.dataset.slug = stats.slug;
    statTarget.textContent = stats.targetUrl;
    statCreated.textContent = fmtDate(stats.createdAt);
    statCount.textContent = String(stats.clickCount);

    statTimeline.innerHTML = '';
    if (stats.recentClicks.length === 0) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'No simulated clicks yet — click "Visit" on this link to record one.';
      statTimeline.appendChild(li);
    } else {
      for (const click of stats.recentClicks) {
        const li = document.createElement('li');
        li.innerHTML = `<span>${fmtDate(click.clickedAt)}</span><span class="badge">simulated visit</span>`;
        statTimeline.appendChild(li);
      }
    }

    statsCard.hidden = false;
    statsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeStats() {
    statsCard.hidden = true;
    delete statsSlug.dataset.slug;
  }

  statsClose.addEventListener('click', closeStats);

  // ---- init -------------------------------------------------------------

  renderLinkList();
})();
