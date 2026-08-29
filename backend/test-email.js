//backend/test-email.js
// ==========================================
// 📧 EMAIL TEST SCRIPT
// Run this with: node test-email.js
// ==========================================

// 1. Fix DNS (Same as Server.js)
const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

// 2. Load Environment Variables
require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('\n🔍 Testing Email Configuration...');
console.log('--------------------------------');
console.log('User:', process.env.EMAIL_USER);
console.log('Pass:', process.env.EMAIL_PASS ? '******** (Hidden)' : '❌ MISSING');

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('\n❌ ERROR: Missing EMAIL_USER or EMAIL_PASS in .env file');
    process.exit(1);
}

// 3. Configure Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// 4. Verify Connection
transporter.verify(function (error, success) {
    if (error) {
        console.error('\n❌ CONNECTION FAILED:');
        console.error(error);
        console.log('\n💡 TIP: Check if your App Password has spaces or if EMAIL_USER matches the account.');
    } else {
        console.log('\n✅ SUCCESS! Server is ready to take our messages');
        console.log('   Credentials are correct.');
    }
});
