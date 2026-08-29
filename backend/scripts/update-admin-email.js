// ===========================
// UPDATE ADMIN EMAIL SCRIPT
// ===========================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const dns = require('dns');

// DNS Fix
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function updateEmail() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        
        const targetUsername = 'AdminHSD';
        const newEmail = 'orfanelpsalm@gmail.com';

        const admin = await Admin.findOne({ username: new RegExp(`^${targetUsername}$`, 'i') });

        if (!admin) {
            console.log(`❌ Admin user '${targetUsername}' not found.`);
        } else {
            admin.email = newEmail;
            await admin.save();
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`✅ SUCCESS: Email updated!`);
            console.log(`User:  ${admin.username}`);
            console.log(`Email: ${admin.email}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

updateEmail();