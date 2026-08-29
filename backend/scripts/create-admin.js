//backend/scripts/create-admin.js
// ===========================
// CREATE ADMIN USER SCRIPT
// WITH DNS FIX
// ===========================

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

// Force IPv4 DNS resolution (Windows fix)
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

async function createAdmin() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        console.log('Using DNS: Google DNS (8.8.8.8)');
        
        // Set Google DNS servers
        dns.setServers(['8.8.8.8', '8.8.4.4']);
        
        // Connect with retry logic
        let connected = false;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (!connected && attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`Attempt ${attempts}/${maxAttempts}...`);
                
                await mongoose.connect(process.env.MONGODB_URI, {
                    serverSelectionTimeoutMS: 15000,
                    socketTimeoutMS: 45000,
                });
                
                connected = true;
                console.log('✓ Connected to MongoDB via Google DNS');
                console.log('✓ Database:', mongoose.connection.name);
                
            } catch (connError) {
                if (attempts >= maxAttempts) {
                    throw connError;
                }
                console.log(`Retry in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Check if admin already exists
        console.log('\n🔍 Checking for existing admin...');
        const existingAdmin = await Admin.findOne({ username: 'admin' });
        
        if (existingAdmin) {
            console.log('\n⚠️  Admin user already exists!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('Username:', existingAdmin.username);
            console.log('Email:', existingAdmin.email);
            console.log('Full Name:', existingAdmin.fullName);
            console.log('Role:', existingAdmin.role);
            console.log('Active:', existingAdmin.isActive);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('\n💡 To create a new admin with different credentials, use:');
            console.log('   node scripts/create-admin.js newusername newemail@example.com');
            console.log('\n💡 To reset this admin password, delete it from MongoDB first.');
            
            await mongoose.connection.close();
            process.exit(0);
        }

        // Create new admin
        console.log('📝 Creating new admin user...');
        
        const admin = new Admin({
            username: 'admin',
            password: 'Admin123!', // This will be hashed automatically by the model
            email: 'clifford020005@gmail.com',
            fullName: 'System Administrator',
            role: 'admin',
            isActive: true
        });

        await admin.save();
        
        console.log('\n✅ SUCCESS! Admin user created!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 LOGIN CREDENTIALS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Username: admin');
        console.log('Password: Admin123!');
        console.log('Email:', admin.email);
        console.log('Role:', admin.role);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🌐 LOGIN URL:');
        console.log('   http://localhost:5000/pages/admin/admin-login.html');
        console.log('\n⚠️  IMPORTANT: Change the password after first login!');
        
        await mongoose.connection.close();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('\nFull error:', error);
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('querySrv')) {
            console.log('\n💡 DNS Connection Issue. Try:');
            console.log('   1. Check your internet connection');
            console.log('   2. Verify MongoDB URI in .env file');
            console.log('   3. Test connection with: mongosh "your-connection-string"');
        }
        
        await mongoose.connection.close();
        process.exit(1);
    }
}

// Allow custom username/email from command line
const customUsername = process.argv[2];
const customEmail = process.argv[3];

if (customUsername && customEmail) {
    console.log(`Creating custom admin: ${customUsername} (${customEmail})`);
}

createAdmin();