'use strict';

/*
 * Browser port of SnapLinks' original src/linkService.js.
 *
 * The original service was bound to a better-sqlite3 database and ran on a
 * Node/Express server. This version keeps the exact same validation rules,
 * slug-generation scheme, and function shapes, but persists to
 * window.localStorage instead of SQLite so the whole thing can run as a
 * static, backend-free demo in the browser.
 *
 * Every "click" recorded here is a *simulated* click: no real HTTP redirect
 * happens (there is no server to redirect through). recordClick() just
 * appends a timestamped, clearly-flagged simulated-click entry.
 */
(function (global) {
  const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const AUTO_SLUG_LENGTH = 7;
  const CUSTOM_SLUG_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/;
  const RESERVED_SLUGS = new Set(['api', 'static', 'favicon.ico', 'health', 'app']);
  const STORAGE_KEY = 'snaplinks.demo.v1';

  class LinkServiceError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.name = 'LinkServiceError';
      this.status = status;
    }
  }

  /**
   * Generates a random, URL-safe slug using the Web Crypto API
   * (the browser equivalent of Node's crypto.randomBytes).
   * @returns {string}
   */
  function generateSlug(length = AUTO_SLUG_LENGTH) {
    const bytes = new Uint8Array(length);
    (global.crypto || {}).getRandomValues(bytes);
    let slug = '';
    for (let i = 0; i < length; i++) {
      slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
    }
    return slug;
  }

  /**
   * Validates that a string is a well-formed, absolute http(s) URL.
   * @param {string} value
   * @returns {URL}
   */
  function parseTargetUrl(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new LinkServiceError('"url" is required.');
    }
    let parsed;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new LinkServiceError('"url" must be a valid absolute URL (e.g. https://example.com).');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new LinkServiceError('"url" must use the http or https protocol.');
    }
    return parsed;
  }

  function validateCustomSlug(slug) {
    if (!CUSTOM_SLUG_PATTERN.test(slug)) {
      throw new LinkServiceError(
        'Custom slug must be 3-32 characters long and contain only letters, numbers, hyphens, and underscores.'
      );
    }
    if (RESERVED_SLUGS.has(slug.toLowerCase())) {
      throw new LinkServiceError(`Slug "${slug}" is reserved and cannot be used.`);
    }
  }

  function loadState() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { links: [], nextId: 1 };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.links)) {
        return { links: [], nextId: 1 };
      }
      return { links: parsed.links, nextId: parsed.nextId || parsed.links.length + 1 };
    } catch {
      return { links: [], nextId: 1 };
    }
  }

  function saveState(state) {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  /**
   * Builds a link service bound to localStorage. Kept free of any DOM
   * concerns so the UI layer (app.js) just calls these functions, the same
   * way the original Express routes called into src/linkService.js.
   */
  function createLinkService() {
    function findBySlug(state, slug) {
      return state.links.find((l) => l.slug === slug);
    }

    /**
     * Creates a shortened link.
     * @param {{url: string, slug?: string}} input
     */
    function createLink({ url, slug } = {}) {
      const targetUrl = parseTargetUrl(url).toString();
      const state = loadState();

      let finalSlug;
      if (slug !== undefined && slug !== null && slug !== '') {
        validateCustomSlug(slug);
        if (findBySlug(state, slug)) {
          throw new LinkServiceError(`Slug "${slug}" is already taken.`, 409);
        }
        finalSlug = slug;
      } else {
        // Auto-generate a slug, retrying on the (astronomically unlikely)
        // chance of a collision, just like the original.
        let candidate = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const c = generateSlug();
          if (!findBySlug(state, c)) {
            candidate = c;
            break;
          }
        }
        if (!candidate) {
          throw new LinkServiceError('Could not generate a unique slug, please try again.', 500);
        }
        finalSlug = candidate;
      }

      const link = {
        id: state.nextId,
        slug: finalSlug,
        targetUrl,
        createdAt: new Date().toISOString(),
        clicks: [],
      };
      state.nextId += 1;
      state.links.unshift(link);
      saveState(state);
      return { ...link, clickCount: 0 };
    }

    function getLinkBySlug(slug) {
      const state = loadState();
      const link = findBySlug(state, slug);
      return link ? { ...link, clickCount: link.clicks.length } : undefined;
    }

    /** Returns all links, newest first, with a clickCount summary field. */
    function listLinks() {
      const state = loadState();
      return state.links.map((l) => ({ ...l, clickCount: l.clicks.length }));
    }

    /**
     * Records a *simulated* click against a link (no real navigation) and
     * returns the updated link.
     * @param {string} slug
     */
    function recordClick(slug) {
      const state = loadState();
      const link = findBySlug(state, slug);
      if (!link) {
        throw new LinkServiceError(`No link found for slug "${slug}".`, 404);
      }
      link.clicks.push({ clickedAt: new Date().toISOString(), simulated: true });
      saveState(state);
      return { ...link, clickCount: link.clicks.length };
    }

    /**
     * Returns click-count and a recent-clicks timeline for a slug.
     * @param {string} slug
     */
    function getStats(slug) {
      const state = loadState();
      const link = findBySlug(state, slug);
      if (!link) {
        throw new LinkServiceError(`No link found for slug "${slug}".`, 404);
      }
      const recentClicks = [...link.clicks]
        .sort((a, b) => (a.clickedAt < b.clickedAt ? 1 : -1))
        .slice(0, 50);
      return {
        slug: link.slug,
        targetUrl: link.targetUrl,
        createdAt: link.createdAt,
        clickCount: link.clicks.length,
        recentClicks,
      };
    }

    /** Removes a link entirely. Not part of the original API, added so the demo's data can be reset per-link. */
    function deleteLink(slug) {
      const state = loadState();
      state.links = state.links.filter((l) => l.slug !== slug);
      saveState(state);
    }

    /** Clears all demo data. */
    function resetAll() {
      saveState({ links: [], nextId: 1 });
    }

    return {
      createLink,
      getLinkBySlug,
      listLinks,
      recordClick,
      getStats,
      deleteLink,
      resetAll,
    };
  }

  global.SnapLinks = {
    createLinkService,
    LinkServiceError,
    parseTargetUrl,
    validateCustomSlug,
    generateSlug,
  };
})(window);
