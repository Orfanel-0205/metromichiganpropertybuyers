//backend/routes/contact.js
// ===========================
// CONTACT ROUTES - Website contact form
// ===========================
// Public endpoint. Forwards a visitor's message to ADMIN_EMAIL using the same
// Nodemailer setup the lead flow uses, and sends the visitor an acknowledgement.

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { sendContactMessage, sendContactAcknowledgement } = require('../utils/email');

const MAX_MESSAGE_LENGTH = 2000;

// ===========================
// RATE LIMIT
// ===========================
// Each submission sends two emails, so this is tighter than the general limit.

const contactLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.CONTACT_RATE_LIMIT, 10) || 5,
    standardHeaders: true,
    legacyHeaders: false,
    // Only successful sends count. Otherwise someone who mistypes their email a
    // few times burns the quota and cannot reach us for 15 minutes.
    skipFailedRequests: true,
    message: {
        success: false,
        message: 'Too many messages from this address. Please try again later, or call (517) 500-8870.'
    }
});

// ===========================
// VALIDATION
// ===========================
// Same pattern as the lead form in routes/leads.js.

const contactValidation = [
    body('name')
        .notEmpty().withMessage('Name is required')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters')
        .escape(),
    body('email')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail()
        .isLength({ max: 200 }).withMessage('Email is too long'),
    body('phone')
        .optional({ checkFalsy: true })
        .customSanitizer((value) => {
            const raw = String(value || '').trim();
            const digits = raw.replace(/\D/g, '');
            return raw.startsWith('+') ? `+${digits}` : digits;
        })
        .matches(/^\+?\d{10,15}$/).withMessage('Enter a valid phone number, or leave it blank'),
    body('message')
        .notEmpty().withMessage('Message is required')
        .trim()
        .isLength({ min: 10, max: MAX_MESSAGE_LENGTH })
        .withMessage(`Message must be between 10 and ${MAX_MESSAGE_LENGTH} characters`)
        .escape(),
    // Honeypot: real visitors never see this field, bots fill it in.
    body('website').optional().isLength({ max: 0 }).withMessage('Spam detected')
];

// express-validator's escape() stores HTML entities. Emails are plain text, so
// decode them back for readability.
function decodeEntities(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#96;/g, '`');
}

// ===========================
// POST /api/contact  (Public)
// ===========================

router.post('/', contactLimiter, contactValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Please check the form and try again.',
                errors: errors.array()
            });
        }

        const contact = {
            name: decodeEntities(req.body.name),
            email: req.body.email,
            phone: req.body.phone || '',
            message: decodeEntities(req.body.message)
        };

        const delivered = await sendContactMessage(contact);

        if (!delivered) {
            // The message never reached the inbox, so do not claim it did.
            return res.status(502).json({
                success: false,
                message: 'We could not send your message right now. Please call (517) 500-8870 or email offer@metromichiganpropertybuyers.com.'
            });
        }

        // Acknowledgement is best-effort; the message is already delivered.
        try {
            await sendContactAcknowledgement(contact);
        } catch (ackError) {
            console.error('Error sending contact acknowledgement:', ackError.message);
        }

        res.status(200).json({
            success: true,
            message: "Thanks for reaching out! We'll get back to you within one business day."
        });

    } catch (error) {
        console.error('Error handling contact submission:', error);
        res.status(500).json({
            success: false,
            message: 'Something went wrong on our end. Please try again, or call (517) 500-8870.'
        });
    }
});

module.exports = router;
