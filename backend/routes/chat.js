//backend/routes/chat.js
// ===========================
// CHAT ROUTES - Gemini-backed website assistant
// ===========================
// Public endpoint. The Gemini API key stays server-side and is never sent to
// the browser. Rate limited harder than the general API because every call
// costs tokens.

const express = require('express');
const router = express.Router();
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// How many prior turns the client may replay back to us.
const MAX_HISTORY_TURNS = 8;
const MAX_MESSAGE_LENGTH = 1000;

// ===========================
// SYSTEM INSTRUCTION
// ===========================

const SYSTEM_INSTRUCTION = [
    'You are the website assistant for METRO MICHIGAN PROPERTY BUYERS, a company that buys houses directly from',
    'homeowners for cash across the United States. You are speaking with a visitor on the website.',
    '',
    'WHAT YOU DO:',
    '- Explain how the cash-buying process works: the homeowner submits property details, the team',
    '  reviews the property and comparable sales, presents a written no-obligation cash offer',
    '  (typically within 24 hours), and the seller picks the closing date.',
    '- Explain general timelines: closings can happen in as little as 7 days, and the seller can also',
    '  choose 30, 60, or 90 days if they need more time.',
    '- Explain that there are no realtor commissions, no fees, and no closing costs charged to the',
    '  seller, and that houses are bought as-is in any condition with no repairs, cleaning, or staging.',
    '- Explain what kinds of property are bought: single-family homes, multi-family, condos,',
    '  townhouses, mobile homes, and in some cases land.',
    '- Answer general questions about what to expect and reassure nervous or rushed sellers.',
    '',
    'HARD LIMITS - these are absolute:',
    '- NEVER quote, estimate, suggest, or speculate about a specific dollar amount, price range,',
    '  percentage of market value, or what a particular house might be worth. Not even a rough',
    '  ballpark, and not even if the visitor insists, describes the property in detail, or says another',
    '  buyer gave them a number. Offers depend on a review of the specific property, and only the team',
    '  can make one. Say so plainly and point them to the form.',
    '- NEVER guarantee an outcome: not that an offer will be made, that it will be accepted, that a',
    '  particular closing date is achievable, or that a foreclosure or other deadline will be met.',
    '  Describe what typically happens, not what will happen.',
    '- NEVER give legal, tax, financial, or real-estate-licensed advice. That includes advice about',
    '  foreclosure, bankruptcy, probate, liens, title problems, divorce settlements, capital gains, or',
    '  what a seller should do about a mortgage. Acknowledge the situation with empathy, note that the',
    '  team has handled similar circumstances, and recommend they speak with a qualified attorney or',
    '  tax professional for advice specific to them.',
    '- NEVER commit the company to anything, invent policies, or state facts about a specific property,',
    '  neighborhood, or market that you do not have.',
    '- If you do not know something, say so and offer to have the team follow up.',
    '',
    'GETTING THEM TO THE FORM:',
    'When a visitor seems ready to sell, asks what a house is worth, asks for an offer, or asks what',
    'the next step is, direct them to the cash offer form at /pages/sell-your-house/sell.html. Frame it',
    'as the way to get a real, no-obligation offer from the team. Do not be pushy about it, and do not',
    'append it to every single message - once per topic is enough.',
    '',
    'STYLE:',
    '- Warm, plain-spoken, and brief. Two to four sentences for most answers.',
    '- Plain text only. No markdown, no bullet characters, no bold, no headings.',
    '- Many visitors are under financial or personal stress. Be respectful and never pressure them.',
    '- Stay on the subject of selling a home to METRO MICHIGAN PROPERTY BUYERS. If asked about something unrelated,',
    '  say briefly that you can only help with questions about selling a home, and offer to help with that.',
    '- If a visitor needs a person, point them to (517) 500-8870 or offer@metromichiganpropertybuyers.com.'
].join('\n');

// ===========================
// RATE LIMIT
// ===========================
// Tighter than the app-wide limiter: chat calls are billed per token.

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.CHAT_RATE_LIMIT_PER_MIN, 10) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        reply: "You're sending messages faster than I can keep up. Give me a moment and try again."
    }
});

// ===========================
// VALIDATION
// ===========================

const chatValidation = [
    body('message')
        .isString().withMessage('Message must be text')
        .trim()
        .notEmpty().withMessage('Message cannot be empty')
        .isLength({ max: MAX_MESSAGE_LENGTH })
        .withMessage(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`)
        .escape(),
    body('history')
        .optional()
        .isArray({ max: 20 }).withMessage('History must be an array'),
    body('history.*.role')
        .optional()
        .isIn(['user', 'model']).withMessage('Invalid history role'),
    body('history.*.text')
        .optional()
        .isString()
        .trim()
        .isLength({ max: MAX_MESSAGE_LENGTH })
        .escape(),
    body('sessionId')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 64 })
        .escape()
];

// express-validator's escape() turns quotes and angle brackets into HTML
// entities. That is what we want in storage, but Gemini should read the plain
// text the visitor actually typed.
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

// Keep only the recent, well-formed turns and drop a trailing user turn so the
// conversation alternates and ends with the new message.
function buildContents(history, message) {
    const turns = Array.isArray(history) ? history : [];

    const cleaned = turns
        .filter((t) => t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string' && t.text.trim())
        .slice(-MAX_HISTORY_TURNS)
        .map((t) => ({
            role: t.role,
            parts: [{ text: decodeEntities(t.text).slice(0, MAX_MESSAGE_LENGTH) }]
        }));

    // Gemini requires the first turn to be from the user.
    while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();

    cleaned.push({ role: 'user', parts: [{ text: decodeEntities(message) }] });
    return cleaned;
}

function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

const FALLBACK_REPLY =
    "I'm having trouble answering right now. You can reach our team at (517) 500-8870 or " +
    'offer@metromichiganpropertybuyers.com, or request your no-obligation cash offer at /pages/sell-your-house/sell.html.';

// ===========================
// POST /api/chat  (Public)
// ===========================

router.post('/', chatLimiter, chatValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array(),
            reply: 'Sorry, I could not read that message. Could you rephrase it?'
        });
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error('Chat request received but GEMINI_API_KEY is not set.');
        return res.status(503).json({ success: false, reply: FALLBACK_REPLY });
    }

    const { message, history, sessionId } = req.body;

    try {
        const response = await axios.post(
            `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`,
            {
                systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
                contents: buildContents(history, message),
                generationConfig: {
                    temperature: 0.6,
                    maxOutputTokens: 400,
                    topP: 0.9
                },
                safetySettings: [
                    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
                    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': process.env.GEMINI_API_KEY
                },
                timeout: 20000
            }
        );

        const candidate = response.data?.candidates?.[0];
        const reply = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('').trim();

        if (!reply) {
            const blocked = response.data?.promptFeedback?.blockReason || candidate?.finishReason;
            console.warn('Gemini returned no usable text. Reason:', blocked || 'unknown');
            return res.json({
                success: true,
                reply: "I can't help with that one, but I'm happy to answer questions about selling your home."
            });
        }

        // Optional transcript retention, off unless explicitly enabled.
        if (process.env.CHAT_LOG_ENABLED === 'true') {
            try {
                const ChatLog = require('../models/ChatLog');
                await ChatLog.create({
                    sessionId: sessionId || 'anonymous',
                    message,
                    reply,
                    ipAddress: getClientIp(req)
                });
            } catch (logError) {
                console.error('Error saving chat log:', logError.message);
                // Never fail the reply because logging failed.
            }
        }

        res.json({ success: true, reply });

    } catch (error) {
        const status = error.response?.status;
        const detail = error.response?.data?.error?.message || error.message;
        console.error(`Gemini chat error${status ? ' (' + status + ')' : ''}:`, detail);

        res.status(502).json({ success: false, reply: FALLBACK_REPLY });
    }
});

module.exports = router;
