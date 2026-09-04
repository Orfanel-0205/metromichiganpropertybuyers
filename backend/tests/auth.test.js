// backend/tests/auth.test.js
// ===========================
// AUTHENTICATION & AUTHORIZATION TESTS
// ===========================
// Runs without a database: Admin.findById is stubbed, so these test the
// middleware's own decisions rather than Mongoose.
//
// Run with:  npm run test:auth

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

const Admin = require('../models/Admin');
const { authMiddleware, authorize, requireSuperAdmin } = require('../middleware/Auth');

// ─────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────

/** Replaces Admin.findById with one that resolves to `doc`. */
function stubAdmin(doc) {
    const original = Admin.findById;
    Admin.findById = () => ({ select: async () => doc });
    return () => { Admin.findById = original; };
}

function makeRes() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function makeReq(token) {
    return {
        headers: {},
        header: (name) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : undefined)
    };
}

function activeAdmin(overrides = {}) {
    return {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        username: 'owner',
        email: 'owner@example.com',
        fullName: 'Owner',
        role: 'superadmin',
        isActive: true,
        // An hour ago, so a token minted now is comfortably valid.
        tokensValidFrom: new Date(Date.now() - 3600_000),
        ...overrides
    };
}

function tokenFor(admin, options = {}) {
    return jwt.sign(
        { id: admin._id.toString(), username: admin.username, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: '8h', ...options }
    );
}

async function run(admin, token) {
    const restore = stubAdmin(admin);
    try {
        const req = makeReq(token);
        const res = makeRes();
        let nextCalled = false;
        await authMiddleware(req, res, () => { nextCalled = true; });
        return { req, res, nextCalled };
    } finally {
        restore();
    }
}

// ─────────────────────────────────────────────────────
// AUTHENTICATION
// ─────────────────────────────────────────────────────

test('a valid token for an active admin is accepted', async () => {
    const admin = activeAdmin();
    const { res, nextCalled, req } = await run(admin, tokenFor(admin));

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(req.admin.username, 'owner');
    assert.equal(req.admin.role, 'superadmin');
});

test('a request with no token is rejected', async () => {
    const { res, nextCalled } = await run(activeAdmin(), null);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('a token signed with the wrong secret is rejected', async () => {
    const admin = activeAdmin();
    const forged = jwt.sign({ id: admin._id.toString(), role: 'superadmin' }, 'not-the-real-secret');
    const { res, nextCalled } = await run(admin, forged);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('an expired token is rejected and says so', async () => {
    const admin = activeAdmin();
    const expired = jwt.sign({ id: admin._id.toString(), role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const { res, nextCalled } = await run(admin, expired);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'TOKEN_EXPIRED');
});

test('a deleted account cannot use a token that is still cryptographically valid', async () => {
    const admin = activeAdmin();
    const token = tokenFor(admin);
    const { res, nextCalled } = await run(null, token);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('a disabled account is locked out immediately, not at token expiry', async () => {
    const admin = activeAdmin();
    const token = tokenFor(admin);
    const { res, nextCalled } = await run(activeAdmin({ isActive: false }), token);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'ACCOUNT_INACTIVE');
});

test('logout invalidates tokens issued before it', async () => {
    const admin = activeAdmin();
    const token = tokenFor(admin);

    // Logout bumps tokensValidFrom to now, which is after this token's iat.
    const afterLogout = activeAdmin({ tokensValidFrom: new Date(Date.now() + 5000) });
    const { res, nextCalled } = await run(afterLogout, token);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'TOKEN_REVOKED');
});

test('a token issued in the same second as the cutoff is not rejected by rounding', async () => {
    const admin = activeAdmin({ tokensValidFrom: new Date() });
    const { nextCalled } = await run(admin, tokenFor(admin));
    assert.equal(nextCalled, true);
});

test('the role comes from the database, not from the token', async () => {
    // A token minted while the account was superadmin, used after a demotion.
    const admin = activeAdmin();
    const staleToken = tokenFor(admin);
    const { req, nextCalled } = await run(activeAdmin({ role: 'admin' }), staleToken);

    assert.equal(nextCalled, true);
    assert.equal(req.admin.role, 'admin', 'a demotion must take effect at once');
});

test('a malformed Authorization header is rejected', async () => {
    const restore = stubAdmin(activeAdmin());
    try {
        for (const header of ['Bearer', 'Bearer    ', 'Token abc', 'abc']) {
            const req = { headers: {}, header: () => header };
            const res = makeRes();
            let nextCalled = false;
            await authMiddleware(req, res, () => { nextCalled = true; });
            assert.equal(nextCalled, false, `should reject: "${header}"`);
            assert.equal(res.statusCode, 401);
        }
    } finally {
        restore();
    }
});

// ─────────────────────────────────────────────────────
// AUTHORIZATION
// ─────────────────────────────────────────────────────

function checkRole(middleware, admin) {
    const req = admin ? { admin } : {};
    const res = makeRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
}

test('a superadmin passes the superadmin gate', () => {
    const { nextCalled } = checkRole(requireSuperAdmin, { role: 'superadmin' });
    assert.equal(nextCalled, true);
});

test('a plain admin is refused by the superadmin gate', () => {
    const { res, nextCalled } = checkRole(requireSuperAdmin, { role: 'admin' });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403, 'wrong role is 403, not 401');
});

test('an unauthenticated request is refused by the role gate', () => {
    const { res, nextCalled } = checkRole(requireSuperAdmin, null);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
});

test('authorize accepts any of the listed roles', () => {
    const gate = authorize('admin', 'superadmin');
    assert.equal(checkRole(gate, { role: 'admin' }).nextCalled, true);
    assert.equal(checkRole(gate, { role: 'superadmin' }).nextCalled, true);
    assert.equal(checkRole(gate, { role: 'viewer' }).nextCalled, false);
});

// ─────────────────────────────────────────────────────
// PASSWORD HANDLING
// ─────────────────────────────────────────────────────

test('the password field is never selected by default', () => {
    assert.equal(Admin.schema.path('password').options.select, false);
});

test('toJSON strips the password hash and the login history', () => {
    const transform = Admin.schema.options.toJSON.transform;
    const output = transform(null, {
        username: 'owner',
        password: '$2a$12$averyrealisticlookingbcrypthashvalue',
        loginLogs: [{ ip: '1.2.3.4' }],
        __v: 0
    });

    assert.equal(output.password, undefined, 'the hash must never be serialised');
    assert.equal(output.loginLogs, undefined);
    assert.equal(output.username, 'owner');
});

test('a company-domain email is a valid admin address', () => {
    const [pattern] = Admin.schema.path('email').options.match;
    assert.equal(pattern.test('owner@metromichiganpropertybuyers.com'), true);
    assert.equal(pattern.test('owner@gmail.com'), true);
    assert.equal(pattern.test('not-an-email'), false);
});
