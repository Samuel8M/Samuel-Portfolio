// Pure blocklist parsing + matching logic, ported from the extension's
// src/background/blocklist.js. The real extension hands the parsed domain
// list to chrome.declarativeNetRequest as `requestDomains` rules, which
// (per the API's own semantics) match a domain and all of its subdomains.
// `hostnameMatchesBlocklist` below reimplements exactly that matching rule
// so this page can show blocked/allowed without the declarativeNetRequest
// API existing outside a real extension.

const BLOCK_RULE_ID_BASE = 1000; // dynamic rule ids owned by FocusGuard start here

// Turns the user's textarea contents into a deduped list of normalized
// domains. Blank lines and lines starting with "#" are ignored so people can
// comment out a site instead of deleting it.
function parseBlocklistText(text) {
  if (!text) return [];
  const seen = new Set();
  const domains = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const domain = normalizeDomain(rawLine);
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
  }
  return domains;
}

// Accepts messy input ("https://www.Example.com/path", "example.com", "#skip")
// and returns a bare registrable-looking domain, or null if the line should
// be skipped / isn't a plausible domain.
function normalizeDomain(raw) {
  let value = raw.trim().toLowerCase();
  if (!value || value.startsWith('#')) return null;
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^www\./, '');
  value = value.split('/')[0];
  value = value.split('?')[0];
  const isValidDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value);
  return isValidDomain ? value : null;
}

// Builds one declarativeNetRequest redirect rule per domain. requestDomains
// matches the domain and all of its subdomains, so "reddit.com" also covers
// "old.reddit.com" without needing a separate entry.
function domainsToBlockRules(domains, redirectUrl) {
  return domains.map((domain, index) => ({
    id: BLOCK_RULE_ID_BASE + index,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { url: redirectUrl },
    },
    condition: {
      requestDomains: [domain],
      resourceTypes: ['main_frame'],
    },
  }));
}

function stringifyBlocklist(domains) {
  return domains.join('\n');
}

// Not present in the extension (which only ever hands requestDomains off to
// Chrome and lets the browser do the matching) — this reimplements that same
// requestDomains semantics: a rule for `domain` matches requests to `domain`
// itself and to any subdomain of it.
function extractHostname(rawUrl) {
  if (!rawUrl) return null;
  const value = rawUrl.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  try {
    return new URL(withScheme).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function hostnameMatchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function hostnameMatchesBlocklist(hostname, domains) {
  if (!hostname) return false;
  return domains.some((domain) => hostnameMatchesDomain(hostname, domain));
}

window.FGBlocklist = {
  BLOCK_RULE_ID_BASE,
  parseBlocklistText,
  normalizeDomain,
  domainsToBlockRules,
  stringifyBlocklist,
  extractHostname,
  hostnameMatchesDomain,
  hostnameMatchesBlocklist,
};
