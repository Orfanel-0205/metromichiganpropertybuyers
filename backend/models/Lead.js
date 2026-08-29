// backend/models/Lead.js
const mongoose = require('mongoose');

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
    status: { 
        type: String, 
        default: 'New', 
        enum: ['New', 'Contacted', 'Under Review', 'Offer Made', 'Closed', 'Not Interested'] 
    },
    priority: { 
        type: String, 
        default: 'Medium', 
        enum: ['High', 'Medium', 'Low'] 
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
        content: { type: String, required: true },
        createdBy: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
    }]
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
leadSchema.methods.updateStatus = async function(newStatus, updatedBy) {
    this.status = newStatus;
    
    if (!this.notes) {
        this.notes = [];
    }
    
    this.notes.push({
        content: `Status changed to ${newStatus}`,
        createdBy: updatedBy,
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
        createdBy,
        createdAt: new Date()
    });
    
    return this.save();
};

module.exports = mongoose.model('Lead', leadSchema);