//backend/models/ChatLog.js
// ===========================
// CHAT LOG MODEL
// ===========================
// Transcript of a single chat exchange, saved only when CHAT_LOG_ENABLED=true.
// Documents expire automatically so transcripts are not retained indefinitely.

const mongoose = require('mongoose');

const chatLogSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
        index: true,
        trim: true,
        maxlength: 64
    },
    message: {
        type: String,
        required: true,
        maxlength: 2000
    },
    reply: {
        type: String,
        required: true,
        maxlength: 8000
    },
    ipAddress: {
        type: String,
        default: ''
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Auto-delete transcripts after CHAT_LOG_TTL_DAYS (default 90).
const ttlDays = parseInt(process.env.CHAT_LOG_TTL_DAYS, 10) || 90;
chatLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });

module.exports = mongoose.model('ChatLog', chatLogSchema);
