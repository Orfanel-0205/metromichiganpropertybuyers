// backend/tests/integration.test.js
// ===========================
// END-TO-END PIPELINE TESTS
// ===========================
// Exercises the real routers against a real (in-memory) MongoDB: the public lead
// form, admin login, the protected dashboard endpoints, and admin-account
// management. Nothing here touches Atlas, and no email, SMS, or Supabase call
// leaves the process - those integrations are stubbed at require time.
//
// Run with:  npm run test:integration
//
// Requires mongodb-memory-server, which is intentionally NOT in package.json:
// its postinstall downloads a ~100MB mongod binary, and that would run on every
// Render deploy for a dependency production never uses. Install it when you want
// to run this suite:
//
//   npm install --no-save mongodb-memory-server
//
// Without it the suite skips rather than failing, so npm test stays green on a
// fresh clone.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

process.env.JWT_SECRET = 'integration-test-secret-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────
// STUB THE OUTBOUND INTEGRATIONS
// ─────────────────────────────────────────────────────
// The lead route fires email, SMS, and the Supabase mirror after responding.
// Intercept them here, before the routers are required, so the tests neither
// send anything nor depend on network access.

const sent = { emails: [], sms: [], mirrors: [] };

const originalResolve = Module._resolveFilename;
const stubs = {
    [path.join(__dirname, '..', 'utils', 'email.js')]: {
        sendLeadConfirmation: async (lead) => { sent.emails.push({ kind: 'confirmation', to: lead.email }); return true; },
        sendAdminNotification: async (lead) => { sent.emails.push({ kind: 'admin', lead }); return true; },
        sendContactMessage: async () => true,
        sendContactAcknowledgement: async () => true,
        getLeadNotificationRecipients: () => ['boss@example.com'],
        getContactRecipients: () => ['boss@example.com']
    },
    [path.join(__dirname, '..', 'utils', 'sms.js')]: {
        sendSMS: async () => ({ ok: true }),
        sendAdminSmsNotification: async (lead) => { sent.sms.push({ kind: 'admin', lead }); return true; },
        sendLeadSmsConfirmation: async (lead) => { sent.sms.push({ kind: 'confirmation', lead }); return true; }
    },
    [path.join(__dirname, '..', 'utils', 'leadContacts.js')]: {
        mirrorLeadContact: async (lead) => { sent.mirrors.push(String(lead._id)); return true; },
        LEAD_CONTACTS_TABLE: 'lead_contacts'
    }
};

for (const [file, exports] of Object.entries(stubs)) {
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
Module._resolveFilename = originalResolve;

// ─────────────────────────────────────────────────────
// HARNESS
// ─────────────────────────────────────────────────────

const express = require('express');
const mongoose = require('mongoose');
const mongoSanitize = require('express-mongo-sanitize');

let mongod = null;
let server = null;
let baseUrl = '';
let available = true;

const Admin = require('../models/Admin');
const Lead = require('../models/Lead');

test.before(async () => {
    let MongoMemoryServer;
    try {
        ({ MongoMemoryServer } = require('mongodb-memory-server'));
        mongod = await MongoMemoryServer.create();
    } catch (error) {
        console.error('\nSkipping integration tests - no in-memory MongoDB available:', error.message);
        available = false;
        return;
    }

    await mongoose.connect(mongod.getUri('mmpb_test'));

    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json({ limit: '10kb' }));
    app.use(mongoSanitize());
    app.use('/api/admin', require('../routes/admin'));
    app.use('/api/leads', require('../routes/leads'));
    app.use('/api', require('../routes/sms'));
    app.use((err, req, res, next) => {
        console.error('Test app error:', err.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    });

    server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.connection.close();
    if (mongod) await mongod.stop();
});

async function call(method, urlPath, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(baseUrl + urlPath, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    return { status: res.status, body: await res.json().catch(() => ({})) };
}

function validLead(overrides = {}) {
    return {
        propertyAddress: '123 Maple Street, Detroit, MI 48201',
        propertyType: 'Single Family',
        propertyCondition: 'Needs Work',
        sellingReason: 'Relocating',
        timeframe: 'ASAP',
        fullName: 'Dana Seller',
        email: 'dana@example.com',
        phone: '5175551234',
        preferredContact: 'Phone',
        bedrooms: 3,
        bathrooms: 2,
        smsConsent: true,
        ...overrides
    };
}

/** Creates an admin directly, bypassing the API, to seed a test. */
async function seedAdmin({ username, role = 'admin', password = 'TestPass123', isActive = true }) {
    return Admin.create({
        username,
        password,
        email: `${username}@example.com`,
        fullName: `${username} test`,
        role,
        isActive
    });
}

async function loginAs(username, password = 'TestPass123') {
    const res = await call('POST', '/api/admin/login', { body: { username, password } });
    return res.body.token;
}

const maybe = (name, fn) => test(name, async (t) => {
    if (!available) return t.skip('no in-memory MongoDB');
    return fn(t);
});

// ─────────────────────────────────────────────────────
// TEST 4/6 - LEAD SUBMISSION AND STORAGE
// ─────────────────────────────────────────────────────

maybe('a valid lead is accepted and stored in MongoDB', async () => {
    const res = await call('POST', '/api/leads', { body: validLead() });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.leadId, 'the API should return the new lead id');

    const stored = await Lead.findById(res.body.leadId);
    assert.ok(stored, 'the lead must be durably in MongoDB');
    assert.equal(stored.fullName, 'Dana Seller');
    assert.equal(stored.status, 'New', 'a new lead starts at "New"');
    assert.equal(stored.priority, 'Medium');
    assert.ok(stored.submittedAt instanceof Date);
});

maybe('the notification email fires after the lead is saved', async () => {
    sent.emails.length = 0;
    const res = await call('POST', '/api/leads', {
        body: validLead({ phone: '5175559999', propertyAddress: '9 Notify Lane, Detroit, MI' })
    });
    assert.equal(res.status, 201);

    // Notifications are deliberately fired after the response, so give the
    // event loop a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const adminEmail = sent.emails.find((e) => e.kind === 'admin');
    assert.ok(adminEmail, 'an admin notification should have been sent');
    assert.equal(adminEmail.lead.fullName, 'Dana Seller');
});

// ─────────────────────────────────────────────────────
// TEST 5 - VALIDATION
// ─────────────────────────────────────────────────────

maybe('a lead missing required fields is rejected with 400', async () => {
    const res = await call('POST', '/api/leads', {
        body: { fullName: 'No Details', email: 'x@example.com' }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message, 'the seller should get a usable message');
});

maybe('a malformed email and a short phone are both rejected', async () => {
    const bad = await call('POST', '/api/leads', { body: validLead({ email: 'not-an-email' }) });
    assert.equal(bad.status, 400);

    const shortPhone = await call('POST', '/api/leads', { body: validLead({ phone: '12345' }) });
    assert.equal(shortPhone.status, 400);
});

maybe('the public form cannot set status, priority, or notes', async () => {
    const res = await call('POST', '/api/leads', {
        body: validLead({
            phone: '5175550001',
            propertyAddress: '1 Escalation Way, Detroit, MI',
            status: 'Closed',
            priority: 'High',
            notes: [{ content: 'injected', createdBy: 'attacker' }],
            source: 'website_form'
        })
    });

    assert.equal(res.status, 201);
    const stored = await Lead.findById(res.body.leadId);
    assert.equal(stored.status, 'New', 'status must not be settable from the public form');
    assert.equal(stored.priority, 'Medium', 'priority must not be settable from the public form');
    assert.equal(stored.notes.length, 0, 'notes must not be settable from the public form');
});

maybe('a repeated identical submission does not create a second lead', async () => {
    const payload = validLead({ phone: '5175552222', propertyAddress: '77 Duplicate Road, Detroit, MI' });

    const first = await call('POST', '/api/leads', { body: payload });
    const second = await call('POST', '/api/leads', { body: payload });

    assert.equal(first.status, 201);
    assert.equal(second.body.success, true, 'the seller should still see success');
    assert.equal(String(second.body.leadId), String(first.body.leadId), 'it should return the original lead');

    const count = await Lead.countDocuments({ phone: '5175552222' });
    assert.equal(count, 1, 'only one lead should exist');
});

// ─────────────────────────────────────────────────────
// TEST 9 - PROTECTED ENDPOINTS
// ─────────────────────────────────────────────────────

maybe('every admin endpoint refuses an unauthenticated request', async () => {
    const endpoints = [
        ['GET', '/api/leads'],
        ['GET', '/api/leads/stats/summary'],
        ['GET', '/api/leads/meta/options'],
        ['GET', '/api/admin/me'],
        ['GET', '/api/admin/list'],
        ['GET', '/api/admin/logs'],
        ['POST', '/api/admin/create'],
        ['POST', '/api/admin/logout'],
        ['POST', '/api/send-sms']
    ];

    for (const [method, url] of endpoints) {
        const res = await call(method, url, { body: method === 'GET' ? undefined : {} });
        assert.equal(res.status, 401, `${method} ${url} must require authentication`);
    }
});

maybe('a single lead and the lead list are not readable without a token', async () => {
    const created = await call('POST', '/api/leads', {
        body: validLead({ phone: '5175553333', propertyAddress: '5 Private Ave, Detroit, MI' })
    });

    const res = await call('GET', `/api/leads/${created.body.leadId}`);
    assert.equal(res.status, 401);
});

// ─────────────────────────────────────────────────────
// TEST 8 - LOGIN
// ─────────────────────────────────────────────────────

maybe('an admin can log in and reach the dashboard endpoints', async () => {
    await seedAdmin({ username: 'worker', role: 'admin' });

    const login = await call('POST', '/api/admin/login', {
        body: { username: 'worker', password: 'TestPass123' }
    });

    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    assert.equal(login.body.admin.role, 'admin');
    assert.equal(login.body.admin.password, undefined, 'the hash must never be returned');

    const leads = await call('GET', '/api/leads', { token: login.body.token });
    assert.equal(leads.status, 200);
    assert.ok(Array.isArray(leads.body.data));
});

maybe('login works with the email address instead of the username', async () => {
    await seedAdmin({ username: 'byemail' });

    const login = await call('POST', '/api/admin/login', {
        body: { username: 'byemail@example.com', password: 'TestPass123' }
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.admin.username, 'byemail');
});

maybe('a wrong password and an unknown user give the same generic answer', async () => {
    await seedAdmin({ username: 'realuser' });

    const wrongPassword = await call('POST', '/api/admin/login', {
        body: { username: 'realuser', password: 'WrongPass123' }
    });
    const unknownUser = await call('POST', '/api/admin/login', {
        body: { username: 'ghostuser', password: 'WrongPass123' }
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownUser.status, 401);
    assert.equal(wrongPassword.body.message, unknownUser.body.message,
        'the two must be indistinguishable or usernames can be enumerated');
});

maybe('a disabled account cannot log in', async () => {
    await seedAdmin({ username: 'disabled', isActive: false });

    const res = await call('POST', '/api/admin/login', {
        body: { username: 'disabled', password: 'TestPass123' }
    });
    assert.equal(res.status, 403);
});

// ─────────────────────────────────────────────────────
// TEST 10/11/12 - ADMIN USER MANAGEMENT
// ─────────────────────────────────────────────────────

maybe('a Super Admin can create another admin, who can then log in', async () => {
    await seedAdmin({ username: 'boss', role: 'superadmin' });
    const token = await loginAs('boss');

    const created = await call('POST', '/api/admin/create', {
        token,
        body: {
            username: 'newhire',
            email: 'newhire@metromichiganpropertybuyers.com',
            fullName: 'New Hire',
            password: 'FreshPass123',
            role: 'admin'
        }
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.admin.role, 'admin');
    assert.equal(created.body.admin.createdBy, 'boss');
    assert.equal(created.body.admin.password, undefined);

    // TEST 12 - the new admin can sign in.
    const login = await call('POST', '/api/admin/login', {
        body: { username: 'newhire', password: 'FreshPass123' }
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
});

maybe('a company-domain email is accepted for a new admin', async () => {
    await seedAdmin({ username: 'boss2', role: 'superadmin' });
    const token = await loginAs('boss2');

    const res = await call('POST', '/api/admin/create', {
        token,
        body: {
            username: 'owner2',
            email: 'owner@metromichiganpropertybuyers.com',
            fullName: 'Company Owner',
            password: 'OwnerPass123'
        }
    });
    assert.equal(res.status, 201);
});

maybe('a plain admin cannot create an admin account', async () => {
    await seedAdmin({ username: 'plainadmin', role: 'admin' });
    const token = await loginAs('plainadmin');

    const res = await call('POST', '/api/admin/create', {
        token,
        body: {
            username: 'sneaky',
            email: 'sneaky@example.com',
            fullName: 'Sneaky Person',
            password: 'SneakyPass123',
            role: 'superadmin'
        }
    });

    assert.equal(res.status, 403, 'privilege escalation must be refused');
    assert.equal(await Admin.countDocuments({ username: 'sneaky' }), 0);
});

maybe('a plain admin cannot list admins or read all login logs', async () => {
    await seedAdmin({ username: 'plainadmin2', role: 'admin' });
    const token = await loginAs('plainadmin2');

    assert.equal((await call('GET', '/api/admin/list', { token })).status, 403);
    assert.equal((await call('GET', '/api/admin/logs/all', { token })).status, 403);
});

maybe('a weak password is refused when creating an admin', async () => {
    await seedAdmin({ username: 'boss3', role: 'superadmin' });
    const token = await loginAs('boss3');

    for (const password of ['short1', 'alllettersonly', '1234567890']) {
        const res = await call('POST', '/api/admin/create', {
            token,
            body: { username: 'weakling', email: 'weak@example.com', fullName: 'Weak Pass', password }
        });
        assert.equal(res.status, 400, `"${password}" should be refused`);
    }
});

maybe('duplicate usernames and emails are refused', async () => {
    await seedAdmin({ username: 'boss4', role: 'superadmin' });
    const token = await loginAs('boss4');

    const base = { username: 'dupe', email: 'dupe@example.com', fullName: 'Dupe One', password: 'DupePass123' };
    assert.equal((await call('POST', '/api/admin/create', { token, body: base })).status, 201);

    const sameUsername = await call('POST', '/api/admin/create', {
        token, body: { ...base, email: 'other@example.com' }
    });
    assert.equal(sameUsername.status, 409);

    // Emails are normalised, so a different case is the same address.
    const sameEmail = await call('POST', '/api/admin/create', {
        token, body: { ...base, username: 'dupe2', email: 'DUPE@Example.COM' }
    });
    assert.equal(sameEmail.status, 409);
});

// ─────────────────────────────────────────────────────
// LAST SUPER ADMIN PROTECTION
// ─────────────────────────────────────────────────────

maybe('the last active Super Admin cannot be disabled or demoted', async () => {
    const onlyBoss = await seedAdmin({ username: 'lonelyboss', role: 'superadmin' });
    const colleague = await seedAdmin({ username: 'colleague', role: 'superadmin' });
    const token = await loginAs('colleague');

    // Two Super Admins exist, so disabling one is allowed.
    const first = await call('PATCH', `/api/admin/${onlyBoss._id}/toggle`, { token });
    assert.equal(first.status, 200);
    assert.equal(first.body.isActive, false);

    // 'colleague' is now the only active Super Admin and cannot disable itself.
    const self = await call('PATCH', `/api/admin/${colleague._id}/toggle`, { token });
    assert.equal(self.status, 400);

    // Nor demote itself.
    const demote = await call('PATCH', `/api/admin/${colleague._id}`, { token, body: { role: 'admin' } });
    assert.equal(demote.status, 400);

    const stillSuper = await Admin.findById(colleague._id);
    assert.equal(stillSuper.role, 'superadmin');
    assert.equal(stillSuper.isActive, true);
});

// ─────────────────────────────────────────────────────
// TEST 16 - LOGOUT
// ─────────────────────────────────────────────────────

maybe('logout makes the token stop working', async () => {
    await seedAdmin({ username: 'leaver' });
    const token = await loginAs('leaver');

    assert.equal((await call('GET', '/api/admin/me', { token })).status, 200);

    const out = await call('POST', '/api/admin/logout', { token });
    assert.equal(out.status, 200);

    const after = await call('GET', '/api/admin/me', { token });
    assert.equal(after.status, 401, 'the token must be rejected after logout');
    assert.equal(after.body.code, 'TOKEN_REVOKED');
});

maybe('disabling an admin ends their session at once', async () => {
    await seedAdmin({ username: 'boss5', role: 'superadmin' });
    const target = await seedAdmin({ username: 'tobedisabled' });

    const bossToken = await loginAs('boss5');
    const targetToken = await loginAs('tobedisabled');

    assert.equal((await call('GET', '/api/admin/me', { token: targetToken })).status, 200);

    await call('PATCH', `/api/admin/${target._id}/toggle`, { token: bossToken });

    const after = await call('GET', '/api/admin/me', { token: targetToken });
    assert.equal(after.status, 401, 'a disabled admin must lose access immediately');
});

maybe('changing a password ends other sessions and returns a fresh token', async () => {
    await seedAdmin({ username: 'changer' });
    const oldToken = await loginAs('changer');

    const res = await call('PATCH', '/api/admin/change-password', {
        token: oldToken,
        body: { currentPassword: 'TestPass123', newPassword: 'BrandNewPass456' }
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.token, 'a replacement token should be issued');

    // The new token works.
    assert.equal((await call('GET', '/api/admin/me', { token: res.body.token })).status, 200);

    // The old password no longer does.
    const oldLogin = await call('POST', '/api/admin/login', {
        body: { username: 'changer', password: 'TestPass123' }
    });
    assert.equal(oldLogin.status, 401);
});

// ─────────────────────────────────────────────────────
// TEST 7 - DASHBOARD LEAD MANAGEMENT
// ─────────────────────────────────────────────────────

maybe('an admin can filter, search, sort, and page through leads', async () => {
    await seedAdmin({ username: 'searcher' });
    const token = await loginAs('searcher');

    await Lead.create(validLead({
        fullName: 'Findable Person', phone: '5175557777',
        propertyAddress: '42 Unique Boulevard, Lansing, MI', status: 'Qualified'
    }));

    const bySearch = await call('GET', '/api/leads?search=Findable', { token });
    assert.equal(bySearch.status, 200);
    assert.equal(bySearch.body.data.length, 1);
    assert.equal(bySearch.body.data[0].fullName, 'Findable Person');

    // Search should also match a partial address.
    const byAddress = await call('GET', '/api/leads?search=Unique%20Boulevard', { token });
    assert.equal(byAddress.body.data.length, 1);

    const byStatus = await call('GET', '/api/leads?status=Qualified', { token });
    assert.equal(byStatus.body.data.length, 1);

    // An unknown status must not be passed through to the query.
    const bogusStatus = await call('GET', '/api/leads?status=Nonsense', { token });
    assert.ok(bogusStatus.body.data.length > 0, 'an unknown status filter is ignored, not applied');

    const paged = await call('GET', '/api/leads?limit=1&skip=0', { token });
    assert.equal(paged.body.data.length, 1);
    assert.ok(paged.body.pagination.total >= 1);
});

maybe('a search term with regex characters is matched literally', async () => {
    await seedAdmin({ username: 'regexsearcher' });
    const token = await loginAs('regexsearcher');

    // Would match everything if the term were compiled as a pattern.
    const res = await call('GET', '/api/leads?search=.*', { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 0, 'regex metacharacters must be escaped');
});

maybe('an admin can change a lead status, and the change is attributed to them', async () => {
    await seedAdmin({ username: 'updater' });
    const token = await loginAs('updater');

    const lead = await Lead.create(validLead({ phone: '5175558888', propertyAddress: '8 Status Street, MI' }));

    const res = await call('PATCH', `/api/leads/${lead._id}/status`, {
        token,
        body: { status: 'Under Contract', priority: 'High' }
    });

    assert.equal(res.status, 200);

    const updated = await Lead.findById(lead._id);
    assert.equal(updated.status, 'Under Contract');
    assert.equal(updated.priority, 'High', 'priority was previously ignored by this route');
    assert.equal(updated.notes.length, 1, 'the change should leave an audit note');
    assert.equal(updated.notes[0].createdBy, 'updater', 'authorship comes from the token');
});

maybe('an unknown status is refused', async () => {
    await seedAdmin({ username: 'badstatus' });
    const token = await loginAs('badstatus');
    const lead = await Lead.create(validLead({ phone: '5175558881', propertyAddress: '9 Bad Status St, MI' }));

    const res = await call('PATCH', `/api/leads/${lead._id}/status`, {
        token, body: { status: 'Totally Made Up' }
    });
    assert.equal(res.status, 400);
});

maybe('an admin can add a note to a lead', async () => {
    await seedAdmin({ username: 'notetaker' });
    const token = await loginAs('notetaker');

    const lead = await Lead.create(validLead({ phone: '5175559999', propertyAddress: '9 Note Lane, MI' }));

    const res = await call('POST', `/api/leads/${lead._id}/notes`, {
        token, body: { content: 'Called, left a voicemail.' }
    });

    assert.equal(res.status, 200);
    const updated = await Lead.findById(lead._id);
    assert.equal(updated.notes[0].content, 'Called, left a voicemail.');
    assert.equal(updated.notes[0].createdBy, 'notetaker');
});

maybe('the dashboard\'s "text" field name is still accepted for a note', async () => {
    await seedAdmin({ username: 'legacynote' });
    const token = await loginAs('legacynote');
    const lead = await Lead.create(validLead({ phone: '5175551111', propertyAddress: '11 Legacy Way, MI' }));

    // The dashboard historically sent { text }, which this route rejected as
    // empty. Both names now work.
    const res = await call('POST', `/api/leads/${lead._id}/notes`, {
        token, body: { text: 'Sent via the old field name.' }
    });

    assert.equal(res.status, 200);
    const updated = await Lead.findById(lead._id);
    assert.equal(updated.notes[0].content, 'Sent via the old field name.');
});

maybe('an empty note is refused', async () => {
    await seedAdmin({ username: 'emptynote' });
    const token = await loginAs('emptynote');
    const lead = await Lead.create(validLead({ phone: '5175551212', propertyAddress: '12 Empty St, MI' }));

    const res = await call('POST', `/api/leads/${lead._id}/notes`, { token, body: { content: '   ' } });
    assert.equal(res.status, 400);
});

maybe('lead statuses are served to the dashboard from the schema', async () => {
    await seedAdmin({ username: 'optionsreader' });
    const token = await loginAs('optionsreader');

    const res = await call('GET', '/api/leads/meta/options', { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.statuses.includes('New'));
    assert.ok(res.body.data.statuses.includes('Under Contract'));
    assert.ok(res.body.data.statuses.includes('Dead Lead'));
    // The legacy value must survive so existing documents stay valid.
    assert.ok(res.body.data.statuses.includes('Under Review'));
});

// ─────────────────────────────────────────────────────
// INJECTION
// ─────────────────────────────────────────────────────

maybe('a NoSQL operator in the login body cannot bypass authentication', async () => {
    await seedAdmin({ username: 'target' });

    const res = await call('POST', '/api/admin/login', {
        body: { username: { $ne: null }, password: { $ne: null } }
    });

    assert.notEqual(res.status, 200, 'operator injection must never authenticate');
    assert.equal(res.body.token, undefined);
});

maybe('an operator in a lead query string does not reach MongoDB', async () => {
    await seedAdmin({ username: 'queryprobe' });
    const token = await loginAs('queryprobe');

    const res = await call('GET', '/api/leads?status[$ne]=New', { token });
    assert.equal(res.status, 200, 'the query should be ignored, not crash the route');
});
