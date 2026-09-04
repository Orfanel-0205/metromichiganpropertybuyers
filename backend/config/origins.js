// backend/config/origins.js
// ===========================
// CORS ORIGIN ALLOWLIST
// ===========================
// The static site (Vercel + the custom domain) and this API (Render) are on
// different origins, so every browser call is cross-origin and the allowlist has
// to be explicit. Wildcards are deliberately not used: /api/admin/* carries a
// bearer token and the API is called with credentials:true, so `*` would be both
// unsafe and rejected by the browser.
//
// An origin is allowed when it matches one of:
//   1. CANONICAL_PRODUCTION_ORIGINS - the company's own domains, hard-coded so a
//      missing/incorrect env var on Render can never take the live site down again.
//   2. FRONTEND_URL / ALLOWED_ORIGINS - comma-separated env additions.
//   3. localhost / 127.0.0.1 on any port  - local development.
//   4. https://<something>.vercel.app     - Vercel preview deploys,
//      unless ALLOW_VERCEL_PREVIEWS=false.
//
// Origins are compared scheme+host+port exactly, after stripping trailing
// slashes. "https://example.com/" and "https://example.com" are the same origin;
// "http://example.com" and "https://example.com" are not.

// The production domains this API exists to serve. Kept in code on purpose:
// these change roughly never, and an env-only allowlist is a single typo away
// from blocking every real visitor.
const CANONICAL_PRODUCTION_ORIGINS = [
    'https://metromichiganpropertybuyers.com',
    'https://www.metromichiganpropertybuyers.com'
];

const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const VERCEL_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

/** Strips trailing slashes and surrounding whitespace so comparisons are exact. */
function normalizeOrigin(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * The full static allowlist: canonical domains plus anything named in
 * FRONTEND_URL or ALLOWED_ORIGINS. Read from process.env on each call so tests
 * (and a Render env change plus restart) are picked up without a rebuild.
 */
function getAllowedOrigins() {
    const fromEnv = [
        process.env.FRONTEND_URL,
        ...(process.env.ALLOWED_ORIGINS || '').split(',')
    ];

    return [...new Set(
        [...CANONICAL_PRODUCTION_ORIGINS, ...fromEnv].map(normalizeOrigin).filter(Boolean)
    )];
}

/**
 * True when a browser at `origin` may call this API.
 *
 * A missing Origin header is allowed: that is a same-origin navigation, a
 * server-to-server call, curl, or a health check. It is not a browser
 * cross-origin request, so there is nothing for CORS to protect against - and
 * these still have to pass authentication like anything else.
 */
function isAllowedOrigin(origin) {
    if (!origin) return true;

    const clean = normalizeOrigin(origin);
    if (getAllowedOrigins().includes(clean)) return true;
    if (LOCAL_ORIGIN_PATTERN.test(clean)) return true;
    if (process.env.ALLOW_VERCEL_PREVIEWS !== 'false' && VERCEL_PREVIEW_PATTERN.test(clean)) return true;

    return false;
}

module.exports = {
    CANONICAL_PRODUCTION_ORIGINS,
    getAllowedOrigins,
    isAllowedOrigin,
    normalizeOrigin
};
