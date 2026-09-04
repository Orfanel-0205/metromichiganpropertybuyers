// ===========================
// ROUTES/ADMIN.JS
// ===========================
// Authentication and admin-account management.
//
// Only POST /login is public. Everything else requires a valid bearer token, and
// the account-management routes additionally require the 'superadmin' role.
// There is deliberately no public registration endpoint: the first account is
// created out-of-band by scripts/bootstrap-admin.js, and every account after
// that is created by a signed-in Super Admin.

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Admin   = require('../models/Admin');
const { authMiddleware, requireSuperAdmin } = require('../middleware/Auth');

const TOKEN_TTL = process.env.JWT_EXPIRES_IN || '8h';
const MIN_PASSWORD_LENGTH = 10;

// ─────────────────────────────────────────────────────
// LOGIN BRUTE-FORCE LIMITER
// ─────────────────────────────────────────────────────
// The general /api/ limiter allows 100 requests per 15 minutes, which is far too
// generous for a password prompt. Successful logins are not counted, so a
// legitimate admin signing in repeatedly is never locked out by their own use.

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message: 'Too many login attempts. Please wait 15 minutes and try again.'
    }
});

// ─────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────

function getClientIP(req) {
    // app.set('trust proxy', 1) means Express has already resolved this.
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

/**
 * Password policy for new and changed passwords. Length is the control that
 * actually matters; the composition rule only rules out the most obvious
 * keyboard-mash entries.
 */
function passwordProblem(password) {
    const value = String(password || '');
    if (value.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (Buffer.byteLength(value, 'utf8') > 72) {
        // bcrypt truncates past 72 bytes, so anything longer would have its tail
        // silently ignored.
        return 'Password must be 72 bytes or fewer.';
    }
    if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
        return 'Password must contain both letters and numbers.';
    }
    return null;
}

function issueToken(admin) {
    return jwt.sign(
        {
            id: admin._id.toString(),
            username: admin.username,
            role: admin.role,
            // Millisecond issue time. The standard iat claim is whole seconds,
            // which is not precise enough to revoke a token that was issued in
            // the same second the revocation happened - see middleware/Auth.js.
            iatMs: Date.now()
        },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    );
}

function publicAdmin(admin) {
    return {
        id:        admin._id,
        username:  admin.username,
        email:     admin.email,
        fullName:  admin.fullName,
        role:      admin.role,
        isActive:  admin.isActive,
        lastLogin: admin.lastLogin,
        createdAt: admin.createdAt,
        createdBy: admin.createdBy
    };
}

function handleValidation(req, res) {
    const errors = validationResult(req);
    if (errors.isEmpty()) return false;
    res.status(400).json({ success: false, message: errors.array()[0].msg });
    return true;
}

// ===========================
// POST /api/admin/login
// Public - authenticate an admin
// ===========================
// Accepts either a username or an email address in `username`. `email` is still
// accepted for the existing login form, but it is only an identifier and never a
// second factor, so a wrong email must not produce a different message from a
// wrong password.
router.post('/login', loginLimiter, async (req, res) => {
    const ip        = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';

    // One message for every failure mode. "No such user" would let anyone
    // enumerate valid admin usernames.
    const GENERIC_FAILURE = 'Invalid credentials.';

    try {
        const { username, email, password } = req.body;
        const identifier = normalizeUsername(username) || normalizeEmail(email);

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required.'
            });
        }

        const admin = await Admin.findOne({
            $or: [
                { username: identifier },
                { email: normalizeEmail(username) || normalizeEmail(email) }
            ]
        }).select('+password');

        if (!admin) {
            console.warn(`Login failed - no account for '${identifier}' [IP: ${ip}]`);
            return res.status(401).json({ success: false, message: GENERIC_FAILURE });
        }

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            console.warn(`Login failed - wrong password for '${admin.username}' [IP: ${ip}]`);
            await admin.recordLogin({ ip, userAgent, success: false });
            return res.status(401).json({ success: false, message: GENERIC_FAILURE });
        }

        // If an email was supplied it has to belong to this account. Checked
        // after the password so a mismatch cannot be used to probe which email
        // addresses exist.
        const suppliedEmail = normalizeEmail(email);
        if (suppliedEmail && suppliedEmail !== admin.email) {
            console.warn(`Login failed - email did not match account '${admin.username}' [IP: ${ip}]`);
            await admin.recordLogin({ ip, userAgent, success: false });
            return res.status(401).json({ success: false, message: GENERIC_FAILURE });
        }

        if (!admin.isActive) {
            await admin.recordLogin({ ip, userAgent, success: false });
            return res.status(403).json({ success: false, message: 'This account has been disabled.' });
        }

        await admin.recordLogin({ ip, userAgent, success: true });

        console.log(`Admin '${admin.username}' logged in [IP: ${ip}]`);

        res.json({
            success: true,
            token: issueToken(admin),
            admin: publicAdmin(admin)
        });

    } catch (error) {
        console.error('Admin login error:', error.message);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// ===========================
// POST /api/admin/logout
// Protected - end the session everywhere
// ===========================
// A JWT cannot be withdrawn once issued, so logout bumps tokensValidFrom and the
// auth middleware rejects anything older. Clearing localStorage alone would
// leave a stolen token usable for the rest of its eight hours.
router.post('/logout', authMiddleware, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id);
        if (admin) await admin.revokeTokens();
        res.json({ success: true, message: 'Logged out.' });
    } catch (error) {
        console.error('Logout error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/me
// Protected - current admin profile
// ===========================
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });
        res.json({ success: true, data: publicAdmin(admin) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/logs
// Protected - login history for the current admin
// ===========================
router.get('/logs', authMiddleware, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id).select('username email loginLogs');
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const logs = [...(admin.loginLogs || [])].reverse();
        res.json({ success: true, data: logs, total: logs.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/logs/all
// Protected (superadmin) - login history across all admins
// ===========================
router.get('/logs/all', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const admins = await Admin.find().select('username email loginLogs');
        const allLogs = admins.flatMap(a =>
            (a.loginLogs || []).map(log => ({
                ...log.toObject(),
                adminUsername: a.username,
                adminEmail:    a.email
            }))
        ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ success: true, data: allLogs, total: allLogs.length });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/list
// Protected (superadmin) - all admin accounts
// ===========================
router.get('/list', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const admins = await Admin.find().sort({ createdAt: -1 });
        res.json({ success: true, data: admins.map(publicAdmin) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// POST /api/admin/create
// Protected (superadmin) - create another admin account
// ===========================
// This previously required only *any* valid token, so a plain admin could mint
// themselves a superadmin. Account creation is now a Super Admin power.
router.post('/create',
    authMiddleware,
    requireSuperAdmin,
    [
        body('username').trim()
            .isLength({ min: 3, max: 40 }).withMessage('Username must be 3-40 characters.')
            .matches(/^[a-zA-Z0-9._-]+$/).withMessage('Username may only contain letters, numbers, dots, dashes and underscores.'),
        body('email').trim().isEmail().withMessage('Enter a valid email address.'),
        body('fullName').trim().isLength({ min: 2, max: 120 }).withMessage('Full name is required.')
    ],
    async (req, res) => {
        if (handleValidation(req, res)) return;

        try {
            const { username, password, email, fullName, role } = req.body;

            const problem = passwordProblem(password);
            if (problem) {
                return res.status(400).json({ success: false, message: problem });
            }

            // Only these two roles exist. Anything else would silently fall back
            // to the schema default, which is not what the caller asked for.
            const requestedRole = role === 'superadmin' ? 'superadmin' : 'admin';

            const cleanUsername = normalizeUsername(username);
            const cleanEmail    = normalizeEmail(email);

            if (await Admin.findOne({ username: cleanUsername })) {
                return res.status(409).json({ success: false, message: 'Username already taken.' });
            }
            if (await Admin.findOne({ email: cleanEmail })) {
                return res.status(409).json({ success: false, message: 'Email already in use.' });
            }

            const newAdmin = await Admin.create({
                username:  cleanUsername,
                password,
                email:     cleanEmail,
                fullName:  String(fullName).trim(),
                role:      requestedRole,
                isActive:  req.body.isActive !== false,
                createdBy: req.admin.username
            });

            console.log(`Admin '${newAdmin.username}' (${newAdmin.role}) created by '${req.admin.username}'`);

            res.status(201).json({
                success: true,
                message: 'Admin created successfully.',
                admin: publicAdmin(newAdmin)
            });

        } catch (error) {
            console.error('Create admin error:', error.message);
            if (error.name === 'ValidationError') {
                const messages = Object.values(error.errors).map(e => e.message);
                return res.status(400).json({ success: false, message: messages.join(' ') });
            }
            // The unique index can still fire if two requests race past the
            // existence checks above.
            if (error.code === 11000) {
                return res.status(409).json({ success: false, message: 'Username or email already in use.' });
            }
            res.status(500).json({ success: false, message: 'Server error.' });
        }
    }
);

// ─────────────────────────────────────────────────────
// LAST SUPER ADMIN GUARD
// ─────────────────────────────────────────────────────
// Disabling or demoting the only active Super Admin would leave the dashboard
// with nobody able to manage accounts and no public endpoint to recover through
// - it would take shell access to the database to undo. Refuse instead.

async function isLastActiveSuperAdmin(adminId) {
    const others = await Admin.countDocuments({
        _id:      { $ne: adminId },
        role:     'superadmin',
        isActive: true
    });
    return others === 0;
}

// ===========================
// PATCH /api/admin/change-password
// Protected - change your own password
// ===========================
// Declared before '/:id' so the literal path is not swallowed by the id param.
router.patch('/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required.' });
        }

        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ success: false, message: problem });

        const admin = await Admin.findById(req.admin.id).select('+password');
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        admin.password = newPassword;
        await admin.save();

        // That save revoked every existing token, this request's included. Hand
        // back a fresh one so the admin is not bounced to the login screen for
        // doing the right thing.
        res.json({
            success: true,
            message: 'Password changed successfully.',
            token: issueToken(admin)
        });
    } catch (error) {
        console.error('Change password error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// PATCH /api/admin/:id/password
// Protected (superadmin) - set another admin's password
// ===========================
// The recovery path for a locked-out colleague. The target's existing sessions
// are dropped by the model's pre-save hook.
router.patch('/:id([0-9a-fA-F]{24})/password', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;
        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ success: false, message: problem });

        const admin = await Admin.findById(req.params.id).select('+password');
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        admin.password = newPassword;
        await admin.save();

        console.log(`Password for '${admin.username}' reset by '${req.admin.username}'`);
        res.json({ success: true, message: 'Password updated. That admin will need to log in again.' });
    } catch (error) {
        console.error('Reset password error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// PATCH /api/admin/:id/toggle
// Protected (superadmin) - flip active state
// ===========================
router.patch('/:id([0-9a-fA-F]{24})/toggle', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        if (admin._id.toString() === req.admin.id) {
            return res.status(400).json({ success: false, message: 'You cannot disable your own account.' });
        }

        if (admin.isActive && admin.role === 'superadmin' && await isLastActiveSuperAdmin(admin._id)) {
            return res.status(400).json({ success: false, message: 'This is the last active Super Admin and cannot be disabled.' });
        }

        admin.isActive = !admin.isActive;
        // A disabled account must lose access now, not in eight hours.
        if (!admin.isActive) admin.tokensValidFrom = new Date();
        await admin.save({ validateBeforeSave: false });

        console.log(`Admin '${admin.username}' ${admin.isActive ? 'enabled' : 'disabled'} by '${req.admin.username}'`);

        res.json({
            success: true,
            message: `Admin ${admin.isActive ? 'activated' : 'deactivated'}.`,
            isActive: admin.isActive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// PATCH /api/admin/:id
// Protected (superadmin) - update role, active state, or name
// ===========================
router.patch('/:id([0-9a-fA-F]{24})', authMiddleware, requireSuperAdmin, async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const isSelf = admin._id.toString() === req.admin.id;
        const { fullName, role, isActive } = req.body;

        if (typeof fullName === 'string' && fullName.trim()) {
            admin.fullName = fullName.trim();
        }

        if (role && ['admin', 'superadmin'].includes(role) && role !== admin.role) {
            if (isSelf) {
                return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
            }
            if (admin.role === 'superadmin' && await isLastActiveSuperAdmin(admin._id)) {
                return res.status(400).json({ success: false, message: 'This is the last active Super Admin. Promote another account first.' });
            }
            admin.role = role;
        }

        if (typeof isActive === 'boolean' && isActive !== admin.isActive) {
            if (isSelf) {
                return res.status(400).json({ success: false, message: 'You cannot disable your own account.' });
            }
            if (!isActive && admin.role === 'superadmin' && await isLastActiveSuperAdmin(admin._id)) {
                return res.status(400).json({ success: false, message: 'This is the last active Super Admin and cannot be disabled.' });
            }
            admin.isActive = isActive;
            if (!isActive) admin.tokensValidFrom = new Date();
        }

        await admin.save({ validateBeforeSave: false });

        console.log(`Admin '${admin.username}' updated by '${req.admin.username}'`);
        res.json({ success: true, message: 'Admin updated.', admin: publicAdmin(admin) });

    } catch (error) {
        console.error('Update admin error:', error.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;
