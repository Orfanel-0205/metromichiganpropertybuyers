//backend/utils/email.js
// ===========================
// EMAIL DELIVERY
// ===========================
// Two transports, chosen at send time:
//
//   Resend (HTTPS)  - used whenever RESEND_API_KEY is set. Render blocks
//                     outbound SMTP, so this is the only one that works there.
//   Gmail SMTP      - the fallback, still fine for local development.
//
// The four send* functions below are unchanged, so nothing that calls them
// needs to know which transport carried the message.

const nodemailer = require('nodemailer');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000;

function usingResend() {
    return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Resend requires a sender on a domain you have verified. Until a domain is
 * verified their shared onboarding@resend.dev address works, but only for
 * delivery to the address that owns the Resend account.
 */
function resendFrom() {
    return process.env.RESEND_FROM || 'Metro Michigan Property Buyers <onboarding@resend.dev>';
}

async function sendViaResend(options) {
    const payload = {
        from: resendFrom(),
        // Resend takes an array, so several recipients cost one API call.
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        text: options.text
    };
    if (options.replyTo) payload.reply_to = options.replyTo;

    const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const detail = data.message || data.error || `HTTP ${response.status}`;
        const error = new Error(detail);
        error.status = response.status;
        throw error;
    }

    return data.id;
}

/**
 * Creates the SMTP transporter only when needed and validates credentials.
 */
const createTransporter = () => {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;

    if (!user || !pass) {
        console.error('❌ Email Error: Missing credentials in .env file');
        return null;
    }

    // Without explicit timeouts nodemailer waits indefinitely. Cloud hosts often
    // throttle or block outbound SMTP, so a send can hang forever and hold open
    // whatever is awaiting it.
    return nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: user,
            pass: pass
        },
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS
    });
};

async function sendViaSmtp(options) {
    const transporter = createTransporter();
    if (!transporter) return null;

    // Nodemailer accepts an array too, but normalising here keeps the log line
    // in sendEmail identical across both transports.
    const info = await transporter.sendMail({
        ...options,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to
    });
    return info.messageId;
}

/**
 * Generic send email function with error handling.
 * Returns true on delivery, false on any failure - never throws.
 */
const sendEmail = async (options) => {
    const via = usingResend() ? 'Resend' : 'SMTP';
    const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to;

    if (!recipients) {
        console.error('Email not sent: no recipient configured. Set LEAD_NOTIFICATION_EMAIL.');
        return false;
    }

    try {
        const id = usingResend()
            ? await sendViaResend(options)
            : await sendViaSmtp(options);

        if (!id) return false;

        console.log(`📧 Email sent via ${via} to ${recipients}: ${id}`);
        return true;

    } catch (error) {
        console.error(`❌ Error sending email via ${via} to ${recipients}:`, error.message);

        if (via === 'Resend') {
            if (error.status === 401 || error.status === 403) {
                console.error('   👉 FIX: RESEND_API_KEY is missing, wrong, or revoked.');
            } else if (error.status === 422) {
                console.error('   👉 FIX: Resend rejected the sender or recipient.');
                console.error('   👉 NOTE: onboarding@resend.dev only delivers to the address that owns the Resend account.');
                console.error('   👉 To send anywhere else, verify a domain and set RESEND_FROM to an address on it.');
            }
        } else if (error.code === 'EAUTH') {
            console.error('   👉 FIX: Check your EMAIL_USER and EMAIL_PASS in .env');
            console.error('   👉 NOTE: If using Gmail, ensure you are using an App Password, not your login password.');
        } else if (error.message && error.message.toLowerCase().includes('timeout')) {
            console.error('   👉 NOTE: The host is likely blocking outbound SMTP. Set RESEND_API_KEY to send over HTTPS instead.');
        }

        return false;
    }
};

// ===========================
// NOTIFICATION RECIPIENTS
// ===========================
// LEAD_NOTIFICATION_EMAIL is the address (or comma-separated addresses) that new
// seller leads are sent to. It is separate from ADMIN_EMAIL on purpose:
// ADMIN_EMAIL is the login identity of the bootstrap admin account, and the
// person who receives leads is not necessarily the person who signs in.
//
// ADMIN_EMAIL is still honoured as a fallback so nothing stops working before
// LEAD_NOTIFICATION_EMAIL is set on Render.

function parseRecipients(raw) {
    return String(raw || '')
        .split(',')
        .map((address) => address.trim())
        .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address));
}

/**
 * Everyone who should be told about a new lead. Returns [] when nothing is
 * configured, and callers skip sending rather than guessing an address.
 */
function getLeadNotificationRecipients() {
    const configured = parseRecipients(process.env.LEAD_NOTIFICATION_EMAIL);
    if (configured.length) return configured;
    return parseRecipients(process.env.ADMIN_EMAIL);
}

/** Recipients for contact-form messages. Falls back to the lead recipients. */
function getContactRecipients() {
    const configured = parseRecipients(process.env.CONTACT_NOTIFICATION_EMAIL);
    if (configured.length) return configured;
    return getLeadNotificationRecipients();
}

/**
 * Sends confirmation email to the seller
 */
const sendLeadConfirmation = async (lead) => {
    if (!lead.email) return;

    const message = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: lead.email,
        subject: 'We received your inquiry - Metro Michigan Property Buyers',
        text: `Hi ${lead.fullName},\n\nThanks for reaching out! We received your details regarding ${lead.propertyAddress}.\n\nWe will review your property and get back to you shortly with a cash offer.\n\nBest regards,\nMetro Michigan Property Buyers Team`
    };

    return sendEmail(message);
};

/**
 * Sends notification email to the admin
 */
const sendAdminNotification = async (lead) => {
    const recipients = getLeadNotificationRecipients();
    if (!recipients.length) {
        console.error('New lead notification not sent: set LEAD_NOTIFICATION_EMAIL.');
        return false;
    }

    // Deliberately only seller and property details. No credentials, no internal
    // configuration, nothing from the tracking payload beyond what the seller
    // typed themselves.
    const lines = [
        'New seller lead from the website.',
        '',
        `Name:            ${lead.fullName}`,
        `Phone:           ${lead.phone}`,
        `Email:           ${lead.email || 'Not provided'}`,
        `Preferred:       ${lead.preferredContact || 'Not specified'}`,
        '',
        `Property:        ${lead.propertyAddress}`,
        `Type:            ${lead.propertyType || 'Not specified'}`,
        `Condition:       ${lead.propertyCondition || 'Not specified'}`,
        `Bed / Bath:      ${lead.bedrooms ?? '-'} / ${lead.bathrooms ?? '-'}`,
        `Mortgage owed:   ${lead.oweMortgage || 'Not specified'}`,
        '',
        `Reason selling:  ${lead.sellingReason || 'Not specified'}`,
        `Timeframe:       ${lead.timeframe || 'Not specified'}`,
        `SMS consent:     ${lead.smsConsent ? 'Yes' : 'No'}`,
        lead.additionalInfo ? `Additional:      ${lead.additionalInfo}` : '',
        '',
        `Submitted:       ${new Date(lead.submittedAt || Date.now()).toLocaleString('en-US', { timeZone: 'America/Detroit' })} (Detroit)`,
        `Lead reference:  ${lead._id}`,
        '',
        'Open the admin dashboard to update the status or add notes.'
    ];

    const message = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: recipients,
        // Replying to the notification answers the seller directly.
        replyTo: lead.email || undefined,
        subject: `New Lead: ${lead.fullName} - ${lead.propertyAddress}`,
        text: lines.join('\n')
    };

    return sendEmail(message);
};

/**
 * Forwards a contact-form message to the admin inbox.
 * replyTo is the visitor's address so hitting Reply answers them directly.
 */
const sendContactMessage = async (contact) => {
    const recipients = getContactRecipients();
    if (!recipients.length) {
        console.error('❌ Contact form: no recipient configured. Set LEAD_NOTIFICATION_EMAIL.');
        return false;
    }

    const message = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: recipients,
        replyTo: contact.email,
        subject: `📨 Contact form: ${contact.name}`,
        text: `New message from the website contact form.\n\nName: ${contact.name}\nEmail: ${contact.email}\n${contact.phone ? `Phone: ${contact.phone}\n` : ''}Received: ${new Date().toLocaleString()}\n\nMessage:\n${contact.message}\n\nReply to this email to respond directly to the sender.`
    };

    return sendEmail(message);
};

/**
 * Confirms to the visitor that their message arrived.
 */
const sendContactAcknowledgement = async (contact) => {
    if (!contact.email) return false;

    const message = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: contact.email,
        subject: 'We got your message - Metro Michigan Property Buyers',
        text: `Hi ${contact.name},\n\nThanks for reaching out. We received your message and someone from our team will get back to you within one business day.\n\nFor a copy of your records, here is what you sent:\n\n${contact.message}\n\nIf it is urgent, call us at (517) 500-8870.\n\nBest regards,\nMetro Michigan Property Buyers Team`
    };

    return sendEmail(message);
};

module.exports = {
    sendLeadConfirmation,
    sendAdminNotification,
    sendContactMessage,
    sendContactAcknowledgement,
    getLeadNotificationRecipients,
    getContactRecipients
};