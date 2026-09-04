//backend/routes/sms.js
// ===========================
// SMS ROUTES
// ===========================
// This endpoint spends real money on the company's ClickSend account and can
// send arbitrary text to any number. It was previously public, which made it an
// open SMS relay: anyone who found the URL could bill the account and send
// messages from the company's sender ID. It is now dashboard-only.

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { sendSMS } = require('../utils/sms');
const { authMiddleware } = require('../middleware/Auth');

// A second limit behind authentication: a compromised or careless admin session
// still should not be able to run up an unbounded bill.
const smsLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.SMS_RATE_LIMIT_PER_HOUR, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'SMS send limit reached for this hour.' }
});

router.post('/send-sms',
  authMiddleware,
  smsLimiter,
  [
    body('phone')
      .customSanitizer((value) => {
        const raw = String(value || '').trim();
        const digits = raw.replace(/\D/g, '');
        return raw.startsWith('+') ? `+${digits}` : digits;
      })
      .matches(/^\+?\d{10,15}$/).withMessage('A valid phone number is required.'),
    body('message')
      .trim()
      .notEmpty().withMessage('Message is required.')
      .isLength({ max: 1000 }).withMessage('Message is too long.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { phone, message } = req.body;

    try {
      await sendSMS(phone, message);
      console.log(`SMS sent to ${phone} by '${req.admin.username}'`);
      res.json({ success: true, message: 'SMS sent successfully' });
    } catch (error) {
      // The provider's error text can name accounts and endpoints; log it, but
      // do not return it.
      console.error('SMS send failed:', error.message);
      res.status(502).json({ success: false, message: 'The SMS provider rejected the message.' });
    }
  }
);

module.exports = router;
