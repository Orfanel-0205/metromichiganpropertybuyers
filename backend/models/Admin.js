// ===========================
// MODELS/ADMIN.JS
// ===========================
// One document per person who can sign into the dashboard.
//
// Roles (values kept as-is so existing accounts and tokens stay valid):
//   'superadmin' - "Super Admin". Manages other admin accounts.
//   'admin'      - "Admin". Works leads and reviews; cannot manage accounts.

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// bcrypt silently truncates at 72 bytes, so a longer password would quietly have
// its tail ignored. Reject it instead of pretending it was accepted.
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 10;

const loginLogSchema = new mongoose.Schema({
    email:     { type: String },
    ip:        { type: String, default: 'unknown' },
    userAgent: { type: String, default: '' },
    success:   { type: Boolean, default: true },
    timestamp: { type: Date, default: Date.now }
}, { _id: true });

const adminSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        trim: true,
        lowercase: true,
        minlength: [3, 'Username must be at least 3 characters'],
        maxlength: [40, 'Username must be 40 characters or fewer'],
        match: [/^[a-z0-9._-]+$/i, 'Username may only contain letters, numbers, dots, dashes and underscores']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`],
        // Never return the hash, even when a caller forgets to .select() around it.
        select: false
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        // Any real address. The previous rule allowed only gmail.com and
        // yahoo.com, which locked out company domains such as the one this site
        // runs on - the owner could not have been given an account at all.
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address']
    },
    fullName: {
        type: String,
        required: [true, 'Full name is required'],
        trim: true,
        maxlength: [120, 'Full name must be 120 characters or fewer']
    },
    role: {
        type: String,
        enum: ['admin', 'superadmin'],
        default: 'admin'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date,
        default: null
    },
    // Tokens issued before this instant are rejected. Bumped on logout, on a
    // password change, and when an account is disabled - which is what makes
    // those actions take effect immediately instead of at token expiry.
    tokensValidFrom: {
        type: Date,
        default: Date.now
    },
    // Who created this account, for the audit trail. Null for the bootstrap owner.
    createdBy: {
        type: String,
        default: null
    },
    loginLogs: {
        type: [loginLogSchema],
        default: []
    }
}, {
    timestamps: true
});

// Hash password before saving
adminSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        if (Buffer.byteLength(this.password, 'utf8') > MAX_PASSWORD_BYTES) {
            return next(new Error(`Password must be ${MAX_PASSWORD_BYTES} bytes or fewer.`));
        }
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);

        // A changed password must not leave older sessions usable. Skip this on
        // the very first save so a freshly created account is not born with a
        // cutoff in the future relative to its own first login.
        if (!this.isNew) {
            this.tokensValidFrom = new Date();
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Compare plain-text password with hash.
// Requires the document to have been loaded with .select('+password').
adminSchema.methods.comparePassword = async function (candidatePassword) {
    if (!this.password) {
        throw new Error('comparePassword called on an Admin loaded without +password');
    }
    return bcrypt.compare(candidatePassword, this.password);
};

// Record a login attempt
adminSchema.methods.recordLogin = async function ({ ip, userAgent, success } = {}) {
    this.loginLogs.push({
        email:     this.email,
        ip:        ip        || 'unknown',
        userAgent: userAgent || '',
        success:   success !== false,
        timestamp: new Date()
    });

    if (this.loginLogs.length > 100) {
        this.loginLogs = this.loginLogs.slice(-100);
    }

    if (success !== false) {
        this.lastLogin = new Date();
    }

    return this.save({ validateBeforeSave: false });
};

/** Invalidates every token already issued to this admin. */
adminSchema.methods.revokeTokens = async function () {
    this.tokensValidFrom = new Date();
    return this.save({ validateBeforeSave: false });
};

// Belt and braces alongside `select: false`: never serialise the hash or the
// login history into an API response.
adminSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        delete ret.loginLogs;
        delete ret.__v;
        return ret;
    }
});

adminSchema.statics.MIN_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
adminSchema.statics.MAX_PASSWORD_BYTES = MAX_PASSWORD_BYTES;

module.exports = mongoose.model('Admin', adminSchema);
