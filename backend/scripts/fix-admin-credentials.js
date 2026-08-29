// ===========================
// FIX ADMIN CREDENTIALS SCRIPT
// ===========================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const dns = require('dns');

// DNS Fix for Windows/Node environments
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function fixCredentials() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected');

        const targetUsername = 'AdminHSD';
        const targetEmail = 'clifford020005@gmail.com';
        const targetPassword = '!0]hW/9dq)#S6;/';

        // Check if ANY admin exists
        const admins = await Admin.find({});
        
        if (admins.length > 0) {
            console.log(`Found ${admins.length} existing admin(s). Updating the first one found...`);
            const admin = admins[0];
            
            console.log(`Updating admin '${admin.username}' to '${targetUsername}'...`);
            
            admin.username = targetUsername;
            admin.email = targetEmail;
            admin.password = targetPassword; // Will be hashed automatically by the pre-save hook
            admin.isActive = true;
            
            await admin.save();
            console.log('✅ Admin credentials updated successfully!');
        } else {
            console.log('No admins found. Creating new admin...');
            await Admin.create({
                username: targetUsername,
                email: targetEmail,
                password: targetPassword,
                fullName: 'System Administrator',
                role: 'admin',
                isActive: true
            });
            console.log('✅ New admin created successfully!');
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('You can now login with:');
        console.log(`Username: ${targetUsername}`);
        console.log(`Email:    ${targetEmail}`);
        console.log(`Password: ${targetPassword}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixCredentials();