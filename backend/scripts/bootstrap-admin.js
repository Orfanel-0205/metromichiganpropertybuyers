// backend/scripts/bootstrap-admin.js
// ===========================
// CREATE OR REPAIR THE FIRST SUPER ADMIN
// ===========================
// This is the only way an account gets created without an existing Super Admin
// signed in. There is no public registration endpoint, by design.
//
// It replaces five earlier scripts (create-admin, insert-admin-direct,
// fix-admin-credentials, reset-password, update-admin-email) that each had a
// password and an email address written into the source and committed to git.
// Nothing here is hard-coded: every value comes from the environment or from an
// interactive prompt, and the password is never printed or logged.
//
// USAGE
//   Interactive (recommended - the password is typed, never stored in a file):
//     npm run bootstrap-admin
//
//   Non-interactive (CI, or a Render one-off shell):
//     ADMIN_USERNAME=owner ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='...' \
//     ADMIN_FULL_NAME='Owner Name' npm run bootstrap-admin
//
//   Repair an existing account (promote to Super Admin, re-enable, set password):
//     npm run bootstrap-admin -- --repair
//
// Passing a password on the command line is deliberately not supported: it would
// land in the shell history and in the process list.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const readline = require('readline');
const mongoose = require('mongoose');

const {
    configureMongoDns,
    getMongooseConnectOptions,
    sanitizeErrorMessage,
    validateMongoUri
} = require('../config/database');

const Admin = require('../models/Admin');

const MIN_PASSWORD_LENGTH = 10;
const REPAIR = process.argv.includes('--repair');

// ─────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────

function ask(question, { silent = false } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        if (!silent) {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer.trim());
            });
            return;
        }

        // Hide the password as it is typed. readline has no built-in for this, so
        // suppress the echo by intercepting output while the answer is pending.
        const onData = (char) => {
            if (['\n', '\r', ''].includes(char.toString())) {
                process.stdin.removeListener('data', onData);
            } else {
                process.stdout.write('\x1B[2K\x1B[200D' + question + '*'.repeat(rl.line.length));
            }
        };

        process.stdout.write(question);
        rl._writeToOutput = () => {};
        process.stdin.on('data', onData);

        rl.question('', (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer.trim());
        });
    });
}

async function askRequired(label, envValue, { silent = false, validate } = {}) {
    let value = (envValue || '').trim();

    while (true) {
        if (!value) {
            if (!process.stdin.isTTY) {
                throw new Error(`${label} is required. Set it in the environment when running non-interactively.`);
            }
            value = await ask(`${label}: `, { silent });
        }

        const problem = validate ? validate(value) : null;
        if (!problem) return value;

        console.error(`  ${problem}`);
        if (!process.stdin.isTTY) {
            throw new Error(`${label} is invalid.`);
        }
        value = '';
    }
}

// ─────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────

function validateUsername(value) {
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(value)) {
        return 'Username must be 3-40 characters: letters, numbers, dots, dashes, underscores.';
    }
    return null;
}

function validateEmail(value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        return 'That does not look like a valid email address.';
    }
    return null;
}

function validatePassword(value) {
    if (value.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (Buffer.byteLength(value, 'utf8') > 72) {
        return 'Password must be 72 bytes or fewer (bcrypt ignores anything past that).';
    }
    if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
        return 'Password must contain both letters and numbers.';
    }
    return null;
}

// ─────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────

async function main() {
    let mongoConfig;
    try {
        mongoConfig = validateMongoUri(process.env.MONGODB_URI);
        configureMongoDns(mongoConfig.isSrv);
    } catch (error) {
        console.error('MongoDB configuration error:', sanitizeErrorMessage(error.message));
        process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoConfig.uri, getMongooseConnectOptions());
    await mongoose.connection.db.admin().ping();
    console.log(`Connected to database "${mongoose.connection.name}".\n`);

    const existingSuperAdmins = await Admin.countDocuments({ role: 'superadmin', isActive: true });
    const totalAdmins = await Admin.countDocuments();

    console.log(`Existing accounts: ${totalAdmins} total, ${existingSuperAdmins} active Super Admin(s).`);

    if (existingSuperAdmins > 0 && !REPAIR) {
        console.log('\nAn active Super Admin already exists.');
        console.log('Add further accounts from the dashboard (Admins tab) rather than here.');
        console.log('To repair or promote an existing account instead, re-run with --repair.');
        return;
    }

    const username = (await askRequired('Username', process.env.ADMIN_USERNAME, { validate: validateUsername })).toLowerCase();
    const email = (await askRequired('Email address', process.env.ADMIN_EMAIL, { validate: validateEmail })).toLowerCase();

    const existing = await Admin.findOne({ $or: [{ username }, { email }] });

    if (existing && !REPAIR) {
        console.log(`\nAn account already exists for "${existing.username}" <${existing.email}>.`);
        console.log('Re-run with --repair to promote it to Super Admin, re-enable it, and set a new password.');
        return;
    }

    const fullName = await askRequired('Full name', process.env.ADMIN_FULL_NAME, {
        validate: (v) => (v.length >= 2 ? null : 'Full name is required.')
    });

    const password = await askRequired('Password', process.env.ADMIN_PASSWORD, {
        silent: true,
        validate: validatePassword
    });

    // Only ask for confirmation when a human is typing; in CI there is nothing
    // to mistype.
    if (process.stdin.isTTY && !process.env.ADMIN_PASSWORD) {
        const again = await ask('Confirm password: ', { silent: true });
        if (again !== password) {
            throw new Error('Passwords did not match. Nothing was changed.');
        }
    }

    if (existing) {
        existing.username = username;
        existing.email = email;
        existing.fullName = fullName;
        existing.role = 'superadmin';
        existing.isActive = true;
        existing.password = password;   // hashed by the model's pre-save hook
        await existing.save();

        console.log('\nAccount repaired and promoted to Super Admin.');
        console.log(`  Username: ${existing.username}`);
        console.log(`  Email:    ${existing.email}`);
        console.log('  Password: (not printed)');
        console.log('\nAny sessions that account already had have been ended.');
        return;
    }

    const admin = await Admin.create({
        username,
        email,
        fullName,
        password,
        role: 'superadmin',
        isActive: true,
        createdBy: 'bootstrap-script'
    });

    console.log('\nSuper Admin created.');
    console.log(`  Username: ${admin.username}`);
    console.log(`  Email:    ${admin.email}`);
    console.log(`  Name:     ${admin.fullName}`);
    console.log('  Password: (not printed - it was never written to disk or logged)');
    console.log('\nSign in at /pages/admin/admin-login and add further admins from the Admins tab.');
}

main()
    .catch((error) => {
        console.error('\nERROR:', sanitizeErrorMessage(error.message));
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
        // The silent-password prompt leaves stdin in raw mode; without this the
        // process keeps the event loop alive and never exits.
        process.stdin.pause();
    });
