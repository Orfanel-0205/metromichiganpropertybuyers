//backend/routes/leads.js
// ===========================
// LEADS ROUTES - API Endpoints
// ===========================
// POST / is the public seller form. Everything else is dashboard-only and sits
// behind authMiddleware.
//
// MongoDB is the source of truth for a lead. Email, SMS, and the Supabase
// contact mirror all run after the response has been sent, and none of them can
// fail a submission - see deliverLeadNotifications below.

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const Lead = require('../models/Lead');
const { LEAD_STATUSES, LEAD_PRIORITIES } = require('../models/Lead');
const { authMiddleware } = require('../middleware/Auth');
const { sendLeadConfirmation, sendAdminNotification } = require('../utils/email');
const { sendAdminSmsNotification, sendLeadSmsConfirmation } = require('../utils/sms');
const { mirrorLeadContact } = require('../utils/leadContacts');

// Sorting is restricted to this list. Passing an arbitrary field straight into
// .sort() lets a caller order by anything in the document, including fields that
// have no index, which is a cheap way to make Atlas do a lot of work.
const SORTABLE_FIELDS = ['submittedAt', 'createdAt', 'updatedAt', 'status', 'priority', 'fullName'];

const MAX_PAGE_SIZE = 200;

// A visitor filling in the form is not a machine. This is deliberately generous
// - a couple of retries after a typo must not lock a real seller out - while
// still stopping an automated flood from filling the collection.
const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.LEAD_RATE_LIMIT, 10) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    message: {
        success: false,
        message: 'You have submitted several times already. Please call us at (517) 500-8870 if you need help.'
    }
});

// ===========================
// VALIDATION MIDDLEWARE
// ===========================

const leadValidation = [
    body('propertyAddress').notEmpty().trim().isLength({ max: 300 }).withMessage('Property address is required'),
    body('propertyType').isIn(['Single Family', 'Multi-Family', 'Condo', 'Townhouse', 'Mobile Home', 'Land']).withMessage('Invalid property type'),
    body('propertyCondition').isIn(['Excellent', 'Good', 'Fair', 'Needs Work', 'Poor']).withMessage('Invalid property condition'),
    body('sellingReason').notEmpty().trim().isLength({ max: 200 }).withMessage('Selling reason is required'),
    body('timeframe').notEmpty().trim().isLength({ max: 100 }).withMessage('Timeframe is required'),
    body('fullName').notEmpty().trim().isLength({ max: 120 }).withMessage('Full name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('phone')
        .customSanitizer((value) => {
            const raw = String(value || '').trim();
            const digits = raw.replace(/\D/g, '');
            return raw.startsWith('+') ? `+${digits}` : digits;
        })
        .matches(/^\+?\d{10,15}$/)
        .withMessage('Valid phone number is required'),
    body('preferredContact').isIn(['Phone', 'Email', 'Text']).withMessage('Invalid contact preference'),
    body('additionalInfo').optional({ checkFalsy: true }).trim().isLength({ max: 2000 }).withMessage('Additional details are too long'),
    body('bedrooms').optional({ checkFalsy: true }).isInt({ min: 0, max: 50 }).withMessage('Bedrooms must be a small whole number'),
    body('bathrooms').optional({ checkFalsy: true }).isFloat({ min: 0, max: 50 }).withMessage('Bathrooms must be a small number')
];

// ===========================
// POST-SAVE NOTIFICATIONS
// ===========================
// Runs after the response has been sent. Every call is independently guarded so
// one slow provider cannot stop the others, and no failure can surface to the
// visitor - their lead is already saved by the time this runs.

async function deliverLeadNotifications(lead) {
    const tasks = [
        ['confirmation email', () => sendLeadConfirmation(lead)],
        ['admin notification email', () => sendAdminNotification(lead)],
        ['confirmation SMS', () => sendLeadSmsConfirmation(lead)],
        ['admin notification SMS', () => sendAdminSmsNotification(lead)],
        ['Supabase contact mirror', () => mirrorLeadContact(lead)]
    ];

    await Promise.allSettled(tasks.map(async ([label, run]) => {
        try {
            await run();
        } catch (error) {
            console.error(`Lead ${lead._id}: ${label} failed:`, error.message);
        }
    }));
}

/**
 * Escapes regex metacharacters so a search term is matched literally.
 * Without this, a search for "a.*" would scan on a wildcard, and a term like
 * "(((" would throw when compiled.
 */
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===========================
// CREATE NEW LEAD (Public - website form)
// ===========================

router.post('/', submitLimiter, leadValidation, async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: errors.array()[0].msg,
                errors: errors.array()
            });
        }

        // req.ip is already resolved from X-Forwarded-For by `trust proxy`.
        const ipAddress = req.ip;

        // Guard against the same person double-submitting - an impatient second
        // click, or a retry after a slow response that actually succeeded. The
        // window is short so a genuine second enquiry about another property
        // still gets through.
        const duplicateWindowMs = 5 * 60 * 1000;
        const existing = await Lead.findOne({
            phone: req.body.phone,
            propertyAddress: req.body.propertyAddress,
            submittedAt: { $gte: new Date(Date.now() - duplicateWindowMs) }
        }).select('_id');

        if (existing) {
            console.log(`Duplicate lead suppressed for ${req.body.phone} (matches ${existing._id})`);
            return res.status(200).json({
                success: true,
                message: 'Lead submitted successfully',
                leadId: existing._id,
                duplicate: true
            });
        }

        // Build the lead explicitly rather than spreading req.body, so a caller
        // cannot set status, priority, or notes from the public form.
        const leadData = {
            propertyAddress: req.body.propertyAddress,
            propertyType: req.body.propertyType,
            propertyCondition: req.body.propertyCondition,
            bedrooms: req.body.bedrooms,
            bathrooms: req.body.bathrooms,
            sellingReason: req.body.sellingReason,
            timeframe: req.body.timeframe,
            oweMortgage: req.body.oweMortgage,
            additionalInfo: req.body.additionalInfo,
            fullName: req.body.fullName,
            email: req.body.email,
            phone: req.body.phone,
            preferredContact: req.body.preferredContact,
            smsConsent: req.body.smsConsent || false,
            tracking: {
                // Only the campaign fields we actually use. Spreading
                // req.body.tracking wholesale would let anyone store arbitrary
                // data on the document.
                utm_source: String(req.body.tracking?.utm_source || '').slice(0, 200),
                utm_medium: String(req.body.tracking?.utm_medium || '').slice(0, 200),
                utm_campaign: String(req.body.tracking?.utm_campaign || '').slice(0, 200),
                gclid: String(req.body.tracking?.gclid || '').slice(0, 200),
                referrer: String(req.body.tracking?.referrer || '').slice(0, 500),
                ipAddress,
                timestamp: new Date()
            },
            source: String(req.body.source || 'website_form').slice(0, 100)
        };

        // Save to database
        const lead = new Lead(leadData);
        await lead.save();

        console.log(`Lead saved: ${lead._id} (${lead.fullName}, ${lead.propertyAddress})`);

        // Emit a socket event for new lead
        const io = req.app.get('socketio');
        if (io) io.emit('new_lead', lead);

        // Respond as soon as the lead is durably saved. Everything below is
        // notification: email, SMS, and the Supabase mirror. None of it may hold
        // the visitor's browser open, because a hung SMTP connection would
        // otherwise leave the form spinning forever on a lead we already have.
        res.status(201).json({
            success: true,
            message: 'Lead submitted successfully',
            leadId: lead._id
        });

        // Fire-and-forget from here. Each settles on its own and logs its own
        // failure; nothing here can touch the response.
        deliverLeadNotifications(lead);

    } catch (error) {
        console.error('Error creating lead:', error);

        // The success response may already have been sent, in which case the
        // lead is saved and there is nothing left to tell the visitor.
        if (res.headersSent) return;

        res.status(500).json({
            success: false,
            message: 'An error occurred while submitting your information. Please try again.'
        });
    }
});

// ===========================
// GET ALL LEADS (Protected - for admin dashboard)
// ===========================

router.get('/', authMiddleware, async (req, res) => {
    try {
        const {
            status,
            priority,
            search,
            startDate,
            endDate,
            limit = 50,
            skip = 0,
            sortBy = 'submittedAt',
            sortOrder = 'desc'
        } = req.query;

        const query = {};

        // Only accept a status the schema actually knows about. An unknown value
        // would silently return nothing and look like data loss.
        if (status && LEAD_STATUSES.includes(status)) {
            query.status = status;
        }
        if (priority && LEAD_PRIORITIES.includes(priority)) {
            query.priority = priority;
        }

        if (startDate || endDate) {
            query.submittedAt = {};
            if (startDate && !Number.isNaN(Date.parse(startDate))) {
                query.submittedAt.$gte = new Date(startDate);
            }
            if (endDate && !Number.isNaN(Date.parse(endDate))) {
                query.submittedAt.$lte = new Date(endDate);
            }
            if (!Object.keys(query.submittedAt).length) delete query.submittedAt;
        }

        // Free-text search across the fields an admin would actually search by.
        // The term is escaped, so it is matched as literal text.
        const term = String(search || '').trim();
        if (term) {
            const rx = new RegExp(escapeRegex(term), 'i');
            query.$or = [
                { fullName: rx },
                { email: rx },
                { phone: rx },
                { propertyAddress: rx }
            ];
        }

        const safeSortBy = SORTABLE_FIELDS.includes(sortBy) ? sortBy : 'submittedAt';
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), MAX_PAGE_SIZE);
        const safeSkip = Math.max(parseInt(skip, 10) || 0, 0);

        const [leads, total] = await Promise.all([
            Lead.find(query)
                .sort({ [safeSortBy]: sortOrder === 'asc' ? 1 : -1 })
                .limit(safeLimit)
                .skip(safeSkip),
            Lead.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: leads,
            pagination: {
                total,
                limit: safeLimit,
                skip: safeSkip,
                hasMore: total > (safeSkip + safeLimit)
            }
        });

    } catch (error) {
        console.error('Error fetching leads:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching leads'
        });
    }
});

// ===========================
// LEAD METADATA (Protected)
// ===========================
// Lets the dashboard build its status and priority dropdowns from the schema
// instead of keeping its own copy that drifts out of date.

router.get('/meta/options', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: { statuses: LEAD_STATUSES, priorities: LEAD_PRIORITIES }
    });
});

// ===========================
// GET LEAD STATISTICS (Protected)
// Declared before '/:id' so the literal path is not captured by the id param.
// ===========================

router.get('/stats/summary', authMiddleware, async (req, res) => {
    try {
        const stats = await Lead.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const total = await Lead.countDocuments();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayCount = await Lead.countDocuments({
            submittedAt: { $gte: today }
        });

        res.json({
            success: true,
            data: {
                total,
                todayCount,
                byStatus: stats
            }
        });

    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching statistics'
        });
    }
});

// ===========================
// GET SINGLE LEAD BY ID (Protected)
// ===========================

router.get('/:id([0-9a-fA-F]{24})', authMiddleware, async (req, res) => {
    try {
        const lead = await Lead.findById(req.params.id);

        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        res.json({
            success: true,
            data: lead
        });

    } catch (error) {
        console.error('Error fetching lead:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching lead'
        });
    }
});

// ===========================
// UPDATE LEAD STATUS / PRIORITY (Protected)
// ===========================
// The dashboard sends status and priority together from one Save button.
// Authorship comes from the verified token, never from the request body -
// otherwise any admin could attribute a change to someone else.

router.patch('/:id([0-9a-fA-F]{24})/status', authMiddleware, async (req, res) => {
    try {
        const { status, priority } = req.body;

        if (status && !LEAD_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Unknown status. Expected one of: ${LEAD_STATUSES.join(', ')}`
            });
        }
        if (priority && !LEAD_PRIORITIES.includes(priority)) {
            return res.status(400).json({
                success: false,
                message: `Unknown priority. Expected one of: ${LEAD_PRIORITIES.join(', ')}`
            });
        }
        if (!status && !priority) {
            return res.status(400).json({ success: false, message: 'Nothing to update.' });
        }

        const lead = await Lead.findById(req.params.id);
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        await lead.updateStatus(status, req.admin.username, priority);

        res.json({
            success: true,
            message: 'Lead updated',
            data: lead
        });

    } catch (error) {
        console.error('Error updating lead status:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating lead status'
        });
    }
});

// ===========================
// ADD NOTE TO LEAD (Protected)
// ===========================

router.post('/:id([0-9a-fA-F]{24})/notes', authMiddleware, async (req, res) => {
    try {
        // The dashboard sent { text } while this route only read { content }, so
        // every note was rejected as empty. Accept either name.
        const content = String(req.body.content ?? req.body.text ?? '').trim();

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'Note content is required'
            });
        }
        if (content.length > 5000) {
            return res.status(400).json({
                success: false,
                message: 'Note is too long (5000 characters maximum).'
            });
        }

        const lead = await Lead.findById(req.params.id);
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        await lead.addNote(content, req.admin.username);

        res.json({
            success: true,
            message: 'Note added successfully',
            data: lead
        });

    } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding note'
        });
    }
});

module.exports = router;
