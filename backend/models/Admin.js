// ===========================
// MODELS/ADMIN.JS
// ===========================

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

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
        lowercase: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        match: [
            /^[^\s@]+@(gmail\.com|yahoo\.com)$/,
            'Only Gmail and Yahoo email addresses are allowed'
        ]
    },
    fullName: {
        type: String,
        required: [true, 'Full name is required'],
        trim: true
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
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Compare plain-text password with hash
adminSchema.methods.comparePassword = async function (candidatePassword) {
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

// Never return password in JSON
adminSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        return ret;
    }
});

module.exports = mongoose.model('Admin', adminSchema);