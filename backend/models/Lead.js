// backend/models/Lead.js
const mongoose = require('mongoose');

// The single source of truth for lead pipeline stages. routes/leads.js validates
// against this and the dashboard renders its dropdown from it, so adding a stage
// here is the only change needed.
const LEAD_STATUSES = [
    'New',
    'Contacted',
    'Follow-Up',
    'Qualified',
    'Appointment',
    'Under Review',
    'Offer Made',
    'Under Contract',
    'Closed',
    'Not Interested',
    'Dead Lead'
];

const LEAD_PRIORITIES = ['High', 'Medium', 'Low'];

const leadSchema = new mongoose.Schema({
    // Property Details
    propertyAddress: { type: String, required: true, trim: true },
    propertyType: { type: String, trim: true },
    propertyCondition: { type: String, trim: true },
    bedrooms: Number,
    bathrooms: Number,
    
    // Situation
    sellingReason: { type: String, trim: true },
    timeframe: { type: String, trim: true },
    oweMortgage: { type: String, trim: true },
    additionalInfo: { type: String, trim: true },
    
    // Contact Info
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    preferredContact: { type: String, trim: true },
    smsConsent: { type: Boolean, default: false },
    
    // System Fields
    // The original six values are all still here, so leads already in Atlas keep
    // validating; the later funnel stages are added alongside them.
    // 'Under Review' is legacy, kept so old documents stay valid.
    status: {
        type: String,
        default: 'New',
        enum: LEAD_STATUSES
    },
    priority: { 
        type: String, 
        default: 'Medium', 
        enum: LEAD_PRIORITIES
    },
    tracking: { type: Object, default: {} },
    submittedAt: { type: Date, default: Date.now },
    source: { type: String, default: 'website_form' },
    
    // SMS Conversation History
    smsConversation: [{
        direction: { 
            type: String, 
            enum: ['inbound', 'outbound'],
            required: true 
        },
        message: { type: String, required: true },
        from: { type: String, required: true },
        to: { type: String, required: true },
        status: { 
            type: String, 
            enum: ['queued', 'sent', 'delivered', 'failed', 'received'],
            default: 'sent'
        },
        twilioSid: { type: String },
        timestamp: { type: Date, default: Date.now },
        readBy: { type: String },
        readAt: { type: Date }
    }],
    
    lastSmsReceived: { type: Date },
    lastSmsSent: { type: Date },
    smsOptOut: { type: Boolean, default: false },
    
    // Notes (for admin use)
    notes: [{
        content: { type: String, required: true, trim: true, maxlength: 5000 },
        // Was required, but nothing ever supplied it, so every status change
        // threw a ValidationError and the save silently failed. The routes now
        // fill it from the authenticated admin; this default is the safety net.
        createdBy: { type: String, default: 'system' },
        createdAt: { type: Date, default: Date.now }
    }]
}, {
    // submittedAt stays the business-facing "when did this lead come in".
    // createdAt/updatedAt are the technical record, and updatedAt is what tells
    // an admin when a lead was last touched.
    timestamps: true
});

// Method to add SMS to conversation
leadSchema.methods.addSms = async function(direction, message, from, to, twilioSid = null) {
    if (!this.smsConversation) {
        this.smsConversation = [];
    }
    
    this.smsConversation.push({
        direction,
        message,
        from,
        to,
        status: direction === 'inbound' ? 'received' : 'sent',
        twilioSid,
        timestamp: new Date()
    });
    
    if (direction === 'inbound') {
        this.lastSmsReceived = new Date();
    } else {
        this.lastSmsSent = new Date();
    }
    
    return this.save();
};

// Method to update status
leadSchema.methods.updateStatus = async function(newStatus, updatedBy, newPriority) {
    const changes = [];

    if (newStatus && newStatus !== this.status) {
        changes.push(`status to ${newStatus}`);
        this.status = newStatus;
    }

    if (newPriority && newPriority !== this.priority) {
        changes.push(`priority to ${newPriority}`);
        this.priority = newPriority;
    }

    if (!changes.length) return this;

    if (!this.notes) {
        this.notes = [];
    }

    // An audit line rather than a user note - this is what makes the pipeline
    // history readable months later.
    this.notes.push({
        content: `Changed ${changes.join(' and ')}`,
        createdBy: updatedBy || 'system',
        createdAt: new Date()
    });

    return this.save();
};

// Method to add note
leadSchema.methods.addNote = async function(content, createdBy) {
    if (!this.notes) {
        this.notes = [];
    }
    
    this.notes.push({
        content,
        createdBy: createdBy || 'system',
        createdAt: new Date()
    });
    
    return this.save();
};

// ===========================
// INDEXES
// ===========================
// The dashboard's default view is "newest first, optionally filtered by status",
// and duplicate detection looks a lead up by phone or email. Without these, each
// of those is a full collection scan.
leadSchema.index({ submittedAt: -1 });
leadSchema.index({ status: 1, submittedAt: -1 });
leadSchema.index({ priority: 1, submittedAt: -1 });
leadSchema.index({ email: 1, submittedAt: -1 });
leadSchema.index({ phone: 1, submittedAt: -1 });

const Lead = mongoose.model('Lead', leadSchema);

module.exports = Lead;
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.LEAD_PRIORITIES = LEAD_PRIORITIES;