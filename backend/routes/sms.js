//backend/routes/sms.js
const express = require('express');
const router = express.Router();
const { sendSMS } = require('../utils/sms');

router.post('/send-sms', async (req, res) => {
  const { phone, message } = req.body;

  try {
    await sendSMS(phone, message);
    res.json({ success: true, message: 'SMS sent successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;