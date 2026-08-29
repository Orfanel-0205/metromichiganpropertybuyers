// backend/Init.js
// Create the first admin user using the same MongoDB connection path as the server.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
    configureMongoDns,
    getMongooseConnectOptions,
    sanitizeErrorMessage,
    validateMongoUri
} = require('./config/database');

let mongoConfig;
try {
    mongoConfig = validateMongoUri(process.env.MONGODB_URI);
    process.env.MONGODB_URI = mongoConfig.uri;
    configureMongoDns(mongoConfig.isSrv);
} catch (error) {
    console.error('MongoDB configuration error:', sanitizeErrorMessage(error.message));
    process.exit(1);
}

const mongoose = require('mongoose');
const Admin = require('./models/Admin');

async function createInitialAdmin() {
    try {
        const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;

        if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_EMAIL) {
            throw new Error('ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_EMAIL must be set in .env.');
        }

        console.log('Connecting to MongoDB Atlas...');
        await mongoose.connect(mongoConfig.uri, getMongooseConnectOptions());
        await mongoose.connection.db.admin().ping();

        console.log('Successfully connected to MongoDB.');
        console.log('Database:', mongoose.connection.name);
        console.log('Host:', mongoose.connection.host);

        const existingAdmin = await Admin.findOne({ role: 'admin' });
        if (existingAdmin) {
            console.log('Admin user already exists.');
            console.log('Username:', existingAdmin.username);
            console.log('Email:', existingAdmin.email);
            return;
        }

        const admin = await Admin.create({
            username: ADMIN_USERNAME,
            password: ADMIN_PASSWORD,
            email: ADMIN_EMAIL,
            fullName: process.env.ADMIN_FULL_NAME || 'System Administrator',
            role: 'admin',
            isActive: true
        });

        console.log('Admin user created successfully.');
        console.log('Username:', admin.username);
        console.log('Email:', admin.email);
        console.log('Password: <not printed>');
    } catch (error) {
        console.error('ERROR:', sanitizeErrorMessage(error.message));
        process.exitCode = 1;
    } finally {
        await mongoose.connection.close().catch(() => {});
    }
}

createInitialAdmin();
