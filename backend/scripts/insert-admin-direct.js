// ===========================
// INSERT ADMIN USER DIRECTLY
// Bypasses Mongoose, uses native MongoDB driver
// ===========================

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const dns = require('dns');

// DNS Fix for Windows
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function insertAdmin() {
    let client;
    try {
        console.log('🔌 Connecting to MongoDB...');
        console.log('Using Google DNS (8.8.8.8)...');
        
        // Validate MONGODB_URI
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in .env file');
        }
        
        console.log('MongoDB URI exists:', process.env.MONGODB_URI.substring(0, 20) + '...');
        
        client = await MongoClient.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
        });
        
        console.log('✓ Connected to MongoDB!');
        
        const db = client.db('uscashbuyers');
        const admins = db.collection('admins');
        
        // Check if admin exists
        console.log('🔍 Checking for existing admin...');
        const existing = await admins.findOne({ username: 'admin' });
        
        if (existing) {
            console.log('\n⚠️  Admin user already exists!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('Username:', existing.username);
            console.log('Email:', existing.email);
            console.log('Full Name:', existing.fullName);
            console.log('Role:', existing.role);
            console.log('Active:', existing.isActive);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('\n✓ You can login with:');
            console.log('   Username: admin');
            console.log('   Password: Admin123!');
            console.log('\n🌐 Login URL:');
            console.log('   http://localhost:5000/pages/admin/admin-login.html');
            await client.close();
            return;
        }
        
        // Hash password
        console.log('🔐 Hashing password...');
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('Admin123!', salt);
        console.log('✓ Password hashed');
        
        // Insert admin
        console.log('📝 Creating admin user...');
        const result = await admins.insertOne({
            username: 'admin',
            password: hashedPassword,
            email: 'clifford020005@gmail.com',
            fullName: 'System Administrator',
            role: 'admin',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        
        console.log('\n✅ SUCCESS! Admin user created!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 LOGIN CREDENTIALS:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Username: admin');
        console.log('Password: Admin123!');
        console.log('Email: clifford020005@gmail.com');
        console.log('Role: admin');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🌐 LOGIN URL:');
        console.log('   http://localhost:5000/pages/admin/admin-login.html');
        console.log('\n⚠️  IMPORTANT: Change the password after first login!');
        
        await client.close();
        console.log('\n✓ Database connection closed');
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error('\nFull error:', error);
        
        if (error.message.includes('ECONNREFUSED') || error.message.includes('querySrv')) {
            console.log('\n💡 DNS Connection Issue. Solutions:');
            console.log('   1. Check internet connection');
            console.log('   2. Verify MongoDB URI in .env file');
            console.log('   3. Make sure MongoDB Atlas allows connections from this machine's current public IP');
        }
        
        if (client) {
            await client.close();
        }
        process.exit(1);
    }
}

insertAdmin();
