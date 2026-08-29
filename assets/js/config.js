// ===========================
// FRONTEND RUNTIME CONFIG - METRO MICHIGAN PROPERTY BUYERS
// ===========================
// The static site (Vercel) and the API (Render) live on different origins in
// production, so pages cannot assume same-origin '/api/...' paths. This file is
// the single place that decides which backend to talk to.
//
// Resolution order:
//   1. window.HSD_API_BASE_URL  - set inline before this script for one-off overrides
//   2. <meta name="hsd-api-base" content="...">  - per-page override
//   3. localhost detection      - local development against `npm run dev`
//   4. PRODUCTION_API_BASE_URL  - the deployed Render URL below
//
// Live API: https://cash-home-buyer-website.onrender.com (Render)
// Live site: https://michiganpropertybuyers.vercel.app (Vercel)
// Leaving it empty falls back to same-origin requests, which is correct when the
// Express server is also serving these pages.

(function () {
    'use strict';

    var PRODUCTION_API_BASE_URL = 'https://cash-home-buyer-website.onrender.com';

    var LOCAL_API_BASE_URL = 'http://localhost:5000';

    function readMetaOverride() {
        var tag = document.querySelector('meta[name="hsd-api-base"]');
        return tag ? tag.getAttribute('content') : '';
    }

    function isLocalHost() {
        var h = window.location.hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '';
    }

    function resolveApiBase() {
        if (window.HSD_API_BASE_URL) return window.HSD_API_BASE_URL;

        var meta = readMetaOverride();
        if (meta) return meta;

        if (isLocalHost()) {
            // When Express serves these pages itself, same-origin already works.
            var servedByBackend = window.location.port === '5000';
            return servedByBackend ? '' : LOCAL_API_BASE_URL;
        }

        return PRODUCTION_API_BASE_URL;
    }

    var apiBase = String(resolveApiBase() || '').replace(/\/+$/, '');

    window.HSD_CONFIG = {
        apiBaseUrl: apiBase,

        // Build a full URL for an API path: apiUrl('/api/leads')
        apiUrl: function (path) {
            var p = String(path || '');
            if (p.charAt(0) !== '/') p = '/' + p;
            return apiBase + p;
        }
    };
})();
