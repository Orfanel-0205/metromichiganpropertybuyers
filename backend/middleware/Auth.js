// backend/middleware/Auth.js
// ===========================
// AUTHENTICATION & AUTHORIZATION MIDDLEWARE
// ===========================
// Every /api/admin route and every non-public lead route goes through
// authMiddleware. It does two things a bare jwt.verify() cannot:
//
//   1. Confirms the account still exists and is still active. A JWT is valid for
//      8 hours no matter what happens to the account inside that window, so
//      without this check disabling an admin would not actually lock them out.
//   2. Honours `tokensValidFrom`, which logout, a password change, and
//      deactivation all bump - that is what makes those take effect at once.
//
// The cost is one indexed findById per request, which is the right trade for an
// endpoint set this small.

const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

function readToken(req) {
    const header = req.header('Authorization') || '';
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
}

const authMiddleware = async (req, res, next) => {
    const token = readToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'No authentication token provided'
        });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        // Distinguish only expiry, so the dashboard can send the user to the
        // login page with a useful message. Everything else stays generic.
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Your session has expired. Please log in again.',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid authentication token'
        });
    }

    try {
        const admin = await Admin.findById(decoded.id).select('username email fullName role isActive tokensValidFrom');

        if (!admin || !admin.isActive) {
            return res.status(401).json({
                success: false,
                message: 'This account is no longer active.',
                code: 'ACCOUNT_INACTIVE'
            });
        }

        // Tokens carry iatMs, a millisecond issue time, because the standard iat
        // claim is only accurate to the second - too coarse to tell "logged out"
        // from "just logged in" when both happen inside the same second.
        //
        // Tokens minted before this claim existed fall back to the end of their
        // iat second. That is deliberately lenient: it keeps sessions that were
        // already open working, and they expire within 8 hours anyway.
        const issuedAtMs = decoded.iatMs || ((decoded.iat || 0) + 1) * 1000;
        const cutoffMs = new Date(admin.tokensValidFrom || 0).getTime();
        if (issuedAtMs < cutoffMs) {
            return res.status(401).json({
                success: false,
                message: 'Your session has ended. Please log in again.',
                code: 'TOKEN_REVOKED'
            });
        }

        // Downstream handlers read role and identity from here, never from the
        // token body, so a role changed in the database applies immediately.
        req.admin = {
            id: admin._id.toString(),
            username: admin.username,
            email: admin.email,
            fullName: admin.fullName,
            role: admin.role
        };
        req.adminDoc = admin;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        res.status(500).json({ success: false, message: 'Authentication check failed.' });
    }
};

/**
 * Role gate. Use after authMiddleware: authorize('superadmin').
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        if (!roles.includes(req.admin.role)) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to access this resource'
            });
        }

        next();
    };
};

/** Convenience alias for the account-management routes. */
const requireSuperAdmin = authorize('superadmin');

module.exports = {
    authMiddleware,
    authorize,
    requireSuperAdmin
};
