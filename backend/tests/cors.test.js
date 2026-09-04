// backend/tests/cors.test.js
// ===========================
// CORS ALLOWLIST TESTS
// ===========================
// Covers the failure that took lead submission down in production: the custom
// domain was not in the allowlist, the rejection surfaced as a 500 with no
// Access-Control-Allow-Origin header, and the browser reported it as a CORS
// error with no usable detail.
//
// Run with:  npm run test:cors

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cors = require('cors');

const { isAllowedOrigin, getAllowedOrigins } = require('../config/origins');

const PROD = 'https://metromichiganpropertybuyers.com';
const PROD_WWW = 'https://www.metromichiganpropertybuyers.com';

// Each test controls its own environment.
function withEnv(vars, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(vars)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

// ─────────────────────────────────────────────────────
// ALLOWLIST
// ─────────────────────────────────────────────────────

test('production domain is allowed even with no environment configuration', () => {
    withEnv({ FRONTEND_URL: undefined, ALLOWED_ORIGINS: undefined }, () => {
        assert.equal(isAllowedOrigin(PROD), true, 'apex domain must be allowed');
        assert.equal(isAllowedOrigin(PROD_WWW), true, 'www domain must be allowed');
    });
});

test('a trailing slash does not change the origin', () => {
    assert.equal(isAllowedOrigin(PROD + '/'), true);
});

test('the old Vercel origin still works when it is configured', () => {
    withEnv({ FRONTEND_URL: 'https://michiganpropertybuyers.vercel.app' }, () => {
        assert.equal(isAllowedOrigin('https://michiganpropertybuyers.vercel.app'), true);
    });
});

test('ALLOWED_ORIGINS accepts a comma-separated list with stray whitespace', () => {
    withEnv({ ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com/ ' }, () => {
        assert.equal(isAllowedOrigin('https://a.example.com'), true);
        assert.equal(isAllowedOrigin('https://b.example.com'), true);
    });
});

test('localhost is allowed on any port for development', () => {
    assert.equal(isAllowedOrigin('http://localhost:5500'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isAllowedOrigin('http://localhost'), true);
});

test('vercel preview deployments are allowed, and can be switched off', () => {
    withEnv({ ALLOW_VERCEL_PREVIEWS: undefined }, () => {
        assert.equal(isAllowedOrigin('https://site-git-branch-team.vercel.app'), true);
    });
    withEnv({ ALLOW_VERCEL_PREVIEWS: 'false' }, () => {
        assert.equal(isAllowedOrigin('https://site-git-branch-team.vercel.app'), false);
    });
});

test('unrelated and look-alike origins are refused', () => {
    withEnv({ FRONTEND_URL: undefined, ALLOWED_ORIGINS: undefined }, () => {
        assert.equal(isAllowedOrigin('https://evil.com'), false);
        // Same name, different scheme.
        assert.equal(isAllowedOrigin('http://metromichiganpropertybuyers.com'), false);
        // Suffix attack: the real domain as someone else's subdomain.
        assert.equal(isAllowedOrigin('https://metromichiganpropertybuyers.com.evil.com'), false);
        // Prefix attack.
        assert.equal(isAllowedOrigin('https://notmetromichiganpropertybuyers.com'), false);
        // A preview-looking host that is not actually on vercel.app.
        assert.equal(isAllowedOrigin('https://preview.vercel.app.evil.com'), false);
    });
});

test('a missing Origin header is allowed (curl, health checks, server-to-server)', () => {
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin(''), true);
});

test('the allowlist never contains a wildcard', () => {
    withEnv({ ALLOWED_ORIGINS: 'https://a.example.com' }, () => {
        assert.ok(!getAllowedOrigins().includes('*'), 'wildcard origin must never be allowed');
    });
});

// ─────────────────────────────────────────────────────
// HTTP BEHAVIOUR
// ─────────────────────────────────────────────────────
// Same middleware arrangement as Server.js, exercised over a real socket.

function buildApp() {
    const app = express();

    const corsOptions = {
        origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400
    };

    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    app.use((req, res, next) => {
        if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
            return res.status(403).json({ success: false, message: 'Origin not allowed by CORS policy.' });
        }
        next();
    });
    app.post('/api/leads', (req, res) => res.status(201).json({ success: true }));

    return app;
}

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function request(server, method, path, headers) {
    const { port } = server.address();
    return fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
}

test('preflight from the production domain succeeds with the right headers', async () => {
    const server = await listen(buildApp());
    try {
        const res = await request(server, 'OPTIONS', '/api/leads', {
            Origin: PROD,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type'
        });

        assert.equal(res.status, 204, 'preflight should return 204, not 500');
        assert.equal(res.headers.get('access-control-allow-origin'), PROD);
        assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
        assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
        assert.match((res.headers.get('access-control-allow-headers') || '').toLowerCase(), /content-type/);
    } finally {
        server.close();
    }
});

test('preflight from www succeeds', async () => {
    const server = await listen(buildApp());
    try {
        const res = await request(server, 'OPTIONS', '/api/leads', {
            Origin: PROD_WWW,
            'Access-Control-Request-Method': 'POST'
        });
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-allow-origin'), PROD_WWW);
    } finally {
        server.close();
    }
});

test('an actual POST from the production domain carries the allow-origin header', async () => {
    const server = await listen(buildApp());
    try {
        const res = await request(server, 'POST', '/api/leads', { Origin: PROD });
        assert.equal(res.status, 201);
        assert.equal(res.headers.get('access-control-allow-origin'), PROD);
    } finally {
        server.close();
    }
});

test('a refused origin gets 403, not 500, and no allow-origin header', async () => {
    const server = await listen(buildApp());
    try {
        const res = await request(server, 'POST', '/api/leads', { Origin: 'https://evil.com' });

        // The old behaviour passed an Error into the CORS callback, which the
        // global handler turned into 500 - indistinguishable from a crash.
        assert.equal(res.status, 403, 'a blocked origin must be a clear 403');
        assert.equal(res.headers.get('access-control-allow-origin'), null,
            'a blocked origin must never receive an allow-origin header');
    } finally {
        server.close();
    }
});

test('a request with no Origin header is served normally', async () => {
    const server = await listen(buildApp());
    try {
        const res = await request(server, 'POST', '/api/leads', {});
        assert.equal(res.status, 201);
    } finally {
        server.close();
    }
});
