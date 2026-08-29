// ===========================
// ROUTES/ADMIN.JS
// ===========================

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const Admin   = require('../models/Admin');
const { authMiddleware, authorize } = require('../middleware/Auth');

// ─────────────────────────────────────────────────────
// HELPER: accept any valid email format
// ─────────────────────────────────────────────────────
function isValidEmail(email) {
    return /^[^\s@]+@(gmail\.com|yahoo\.com)$/.test(email.trim().toLowerCase());
}

// ─────────────────────────────────────────────────────
// HELPER: get client IP
// ─────────────────────────────────────────────────────
function getClientIP(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

// ===========================
// POST /api/admin/login
// Public — authenticate admin
// ===========================
router.post('/login', async (req, res) => {
    const ip        = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';

    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username, email, and password are required.'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Only Gmail and Yahoo email addresses are allowed.'
            });
        }

        const admin = await Admin.findOne({ username: username.toLowerCase().trim() });

        if (!admin) {
            console.warn(`⚠️  Login failed — username '${username}' not found  [IP: ${ip}]`);
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            console.warn(`⚠️  Login failed — wrong password for '${username}'  [IP: ${ip}]`);
            await admin.recordLogin({ ip, userAgent, success: false });
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        if (!admin.isActive) {
            await admin.recordLogin({ ip, userAgent, success: false });
            return res.status(403).json({ success: false, message: 'Account is inactive.' });
        }

        await admin.recordLogin({ ip, userAgent, success: true });

        const token = jwt.sign(
            { id: admin._id, username: admin.username, role: admin.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        console.log(`✅ Admin '${admin.username}' <${admin.email}> logged in  [IP: ${ip}]`);

        res.json({
            success: true,
            token,
            admin: {
                id:       admin._id,
                username: admin.username,
                email:    admin.email,
                fullName: admin.fullName,
                role:     admin.role
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// ===========================
// GET /api/admin/me
// Protected — current admin profile
// ===========================
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const admin = await Admin.findById(req.admin.id);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });
        res.json({ success: true, data: admin });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/logs
// Protected — login logs for the current admin
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
// Protected (superadmin) — logs for ALL admins
// ===========================
router.get('/logs/all', authMiddleware, authorize('superadmin'), async (req, res) => {
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
// POST /api/admin/create
// Protected — create a new admin (any valid email)
// ===========================
router.post('/create', authMiddleware, async (req, res) => {
    try {
        const { username, password, email, fullName, role } = req.body;

        if (!username || !password || !email || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Username, password, email, and full name are required.'
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                success: false,
                message: 'Only Gmail and Yahoo email addresses are allowed.'
            });
        }

        const existingUsername = await Admin.findOne({ username: username.toLowerCase().trim() });
        if (existingUsername) {
            return res.status(409).json({ success: false, message: 'Username already taken.' });
        }

        const existingEmail = await Admin.findOne({ email: email.toLowerCase().trim() });
        if (existingEmail) {
            return res.status(409).json({ success: false, message: 'Email already in use.' });
        }

        const newAdmin = await Admin.create({
            username:  username.trim(),
            password,
            email:     email.trim(),
            fullName:  fullName.trim(),
            role:      role || 'admin',
            isActive:  true
        });

        console.log(`✅ New admin '${newAdmin.username}' <${newAdmin.email}> created by '${req.admin.username}'`);

        res.status(201).json({
            success: true,
            message: 'Admin created successfully.',
            admin: {
                id:       newAdmin._id,
                username: newAdmin.username,
                email:    newAdmin.email,
                fullName: newAdmin.fullName,
                role:     newAdmin.role
            }
        });

    } catch (error) {
        console.error('Create admin error:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ success: false, message: messages.join(' ') });
        }
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// GET /api/admin/list
// Protected (superadmin) — list all admins
// ===========================
router.get('/list', authMiddleware, authorize('superadmin'), async (req, res) => {
    try {
        const admins = await Admin.find().sort({ createdAt: -1 });
        res.json({ success: true, data: admins });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// ===========================
// PATCH /api/admin/:id/toggle
// Protected — activate / deactivate an admin
// ===========================
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        if (admin._id.toString() === req.admin.id) {
            return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
        }

        admin.isActive = !admin.isActive;
        await admin.save({ validateBeforeSave: false });

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
// PATCH /api/admin/change-password
// Protected — change own password
// ===========================
router.patch('/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Current and new password are required.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
        }

        const admin = await Admin.findById(req.admin.id);
        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        admin.password = newPassword;
        await admin.save();

        res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

module.exports = router;