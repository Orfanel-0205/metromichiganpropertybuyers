// ===========================
// RESET ADMIN PASSWORD SCRIPT
// ===========================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const dns = require('dns');

// DNS Fix
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function resetPassword() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Connected');

        const username = 'admin';
        const newPassword = 'Admin123!';

        // Find the admin user
        let admin = await Admin.findOne({ username });

        if (!admin) {
            console.log(`❌ Admin user '${username}' not found.`);
            console.log('Creating new admin user...');
            admin = new Admin({
                username: 'admin',
                email: 'admin@example.com',
                fullName: 'System Administrator',
                role: 'admin',
                isActive: true
            });
        } else {
            console.log(`✓ Found admin user: ${admin.username}`);
        }

        // Set the new password (plain text)
        // The pre-save hook in Admin.js will hash this automatically
        admin.password = newPassword;
        
        await admin.save();

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ PASSWORD RESET SUCCESSFUL');
        console.log(`👤 Username: ${username}`);
        console.log(`🔑 Password: ${newPassword}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

resetPassword();