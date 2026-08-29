// ===========================
// BACKEND SERVER - METRO MICHIGAN PROPERTY BUYERS
// ===========================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
    configureMongoDns,
    getMongooseConnectOptions,
    getTroubleshootingHints,
    sanitizeErrorMessage,
    validateMongoUri
} = require('./config/database');

let mongoConfig;
try {
    mongoConfig = validateMongoUri(process.env.MONGODB_URI);
    process.env.MONGODB_URI = mongoConfig.uri;

    const dnsConfig = configureMongoDns(mongoConfig.isSrv);
    console.log('MongoDB URI loaded for host:', mongoConfig.host);
    console.log('MongoDB database:', mongoConfig.databaseName);
    if (dnsConfig.changed) {
        console.log('MongoDB SRV DNS resolvers:', dnsConfig.servers.join(', '));
    }
} catch (error) {
    console.error('MongoDB configuration error:', sanitizeErrorMessage(error.message));
    process.exit(1);
}

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const { Server } = require('socket.io');

const Admin = require('./models/Admin');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = mongoConfig.uri;
const maxAttempts = 3;

if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET not found in .env, using default. Set a strong secret before production.');
    process.env.JWT_SECRET = 'change_this_to_a_secure_random_string';
}

if (process.env.EMAIL_USER) process.env.EMAIL_USER = process.env.EMAIL_USER.trim();
if (process.env.EMAIL_PASS) process.env.EMAIL_PASS = process.env.EMAIL_PASS.trim();

// Resend sends over HTTPS and is the only transport that works on hosts that
// block outbound SMTP (Render does). SMTP stays as the local-development path.
if (process.env.RESEND_API_KEY) {
    console.log('Email transport: Resend (HTTPS), from', process.env.RESEND_FROM || 'onboarding@resend.dev');
} else if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('No email transport configured. Set RESEND_API_KEY, or EMAIL_USER and EMAIL_PASS. Emails will not send.');
} else {
    console.log('Email transport: SMTP via', process.env.EMAIL_SERVICE || 'gmail', 'as', process.env.EMAIL_USER);
    console.warn('  NOTE: hosts that block outbound SMTP will time out. Set RESEND_API_KEY there.');
}

if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY missing in .env. The website chat assistant will be unavailable.');
} else {
    console.log('Gemini chat enabled with model:', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
}

// Supabase mirroring fails silently by design (a lead must never fail because of
// it), so report its status at startup like the other integrations do.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.warn('SUPABASE_URL or SUPABASE_SECRET_KEY missing in .env. Lead contact mirroring is disabled.');
} else {
    try {
        const host = new URL(process.env.SUPABASE_URL).host;
        console.log('Supabase lead mirroring enabled for project:', host);
    } catch (error) {
        const bad = String(process.env.SUPABASE_URL);
        const hint = bad.startsWith('sb_') || bad.startsWith('eyJ')
            ? 'that looks like an API key, not the project URL'
            : 'expected something like https://<project>.supabase.co';
        console.warn(`SUPABASE_URL is not a valid URL (${bad.length} chars) - ${hint}. Lead contact mirroring will fail.`);
    }
}

if (!process.env.CLICKSEND_USERNAME || !process.env.CLICKSEND_API_KEY) {
    console.warn('CLICKSEND credentials missing in .env. SMS will not send.');
} else {
    console.log('ClickSend credentials loaded for:', process.env.CLICKSEND_USERNAME);
}

// Render, Railway, and Fly all sit behind a proxy. Without this every request
// looks like it came from the proxy's IP, so the rate limiters share one bucket
// and lead tracking records the wrong address. Trust exactly one hop.
app.set('trust proxy', process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : 1);

app.use(helmet({ contentSecurityPolicy: false }));
// ===========================
// CORS
// ===========================
// The static site is served from Vercel while this API runs on Render, so the
// allowed origins have to be listed explicitly. Set ALLOWED_ORIGINS in .env as a
// comma-separated list; FRONTEND_URL is always included. Vercel preview deploys
// (*.vercel.app) are matched by pattern so every preview build does not need an entry.

const staticAllowedOrigins = [
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_ORIGINS || '').split(',')
].map((o) => (o || '').trim().replace(/\/+$/, '')).filter(Boolean);

// FRONTEND_URL and ALLOWED_ORIGINS usually name the same host; list it once.
const allowedOrigins = [...new Set(staticAllowedOrigins)];

const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

function isAllowedOrigin(origin) {
    // No Origin header: same-origin navigation, curl, or a server-to-server call.
    if (!origin) return true;

    const clean = origin.replace(/\/+$/, '');
    if (allowedOrigins.includes(clean)) return true;
    if (localOriginPattern.test(clean)) return true;
    if (process.env.ALLOW_VERCEL_PREVIEWS !== 'false' && vercelPreviewPattern.test(clean)) return true;

    return false;
}

app.use(cors({
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);
        console.warn('Blocked CORS request from origin:', origin);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

console.log('CORS allowed origins:', allowedOrigins.length ? allowedOrigins.join(', ') : '(localhost only)');
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(mongoSanitize());

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    // /api/chat has its own, tighter per-minute limiter. Counting chat messages
    // here too would let a chatty visitor exhaust the shared budget and lock
    // themselves out of submitting the lead form.
    skip: (req) => req.path.startsWith('/chat')
});
app.use('/api/', apiLimiter);

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => callback(isAllowedOrigin(origin) ? null : new Error('Not allowed by CORS'), true),
        methods: ['GET', 'POST'],
        credentials: true
    }
});

app.set('socketio', io);

io.on('connection', (socket) => {
    console.log('User connected via WebSocket');
    socket.on('disconnect', () => console.log('User disconnected'));
});

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureAdminExists() {
    const adminCount = await Admin.countDocuments();

    if (adminCount > 0) {
        console.log(`Found ${adminCount} admin(s) in database`);
        return;
    }

    const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_EMAIL) {
        console.warn('No admin user exists. Set ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_EMAIL, then run npm run init.');
        return;
    }

    await Admin.create({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        email: ADMIN_EMAIL,
        fullName: process.env.ADMIN_FULL_NAME || 'System Administrator',
        role: 'admin',
        isActive: true
    });

    console.log('Default admin created from environment credentials.');
    console.log('Admin username:', ADMIN_USERNAME);
    console.log('Admin email:', ADMIN_EMAIL);
}

async function connectDatabase() {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`MongoDB connection attempt ${attempt}/${maxAttempts}`);

            await mongoose.connect(MONGODB_URI, getMongooseConnectOptions());
            const ping = await mongoose.connection.db.admin().ping();

            if (!ping || ping.ok !== 1) {
                throw new Error('MongoDB ping did not return ok: 1.');
            }

            console.log('Connected to MongoDB Atlas.');
            console.log('Database:', mongoose.connection.name);
            console.log('Host:', mongoose.connection.host);

            await ensureAdminExists();
            return;
        } catch (err) {
            await mongoose.disconnect().catch(() => {});
            console.error('MongoDB connection error:', sanitizeErrorMessage(err.message));

            if (attempt < maxAttempts) {
                console.log('Retrying MongoDB connection in 3 seconds...');
                await wait(3000);
            } else {
                console.error(`Failed to connect to MongoDB after ${maxAttempts} attempts.`);
                console.error('Troubleshooting:');
                getTroubleshootingHints(err, mongoConfig.isSrv).forEach((hint) => {
                    console.error(`- ${hint}`);
                });
                throw err;
            }
        }
    }
}

mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
mongoose.connection.on('error', (err) => console.error('MongoDB error:', sanitizeErrorMessage(err.message)));
mongoose.connection.on('connected', () => console.log('Mongoose connected successfully'));

app.get('/api/health', (req, res) => {
    const connected = mongoose.connection.readyState === 1;

    res.status(connected ? 200 : 503).json({
        status: connected ? 'ok' : 'degraded',
        database: connected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api', require('./routes/sms'));
app.use('/api', require('./routes/testimonials'));

app.use((req, res, next) => {
    const forbidden = ['/backend', '/.env', '/node_modules', '/.git'];
    if (forbidden.some((folder) => req.path.startsWith(folder))) {
        return res.status(403).send('Forbidden');
    }
    next();
});

// extensions: ['html'] mirrors Vercel's cleanUrls, so /pages/faq/faq resolves to
// faq.html locally exactly as it does on the deployed static site.
app.use(express.static(path.join(__dirname, '../'), { extensions: ['html'] }));

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error'
    });
});

async function startServer() {
    try {
        await connectDatabase();
        server.listen(PORT, () => {
            console.log(`Server running: http://localhost:${PORT}`);
            console.log(`Admin panel: http://localhost:${PORT}/pages/admin/admin-login.html`);
        });
    } catch (error) {
        console.error('Server not started because MongoDB connection failed.');
        process.exit(1);
    }
}

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Server port ${PORT} is already in use. Stop the process using that port or set a different PORT in .env.`);
    } else {
        console.error('Server error:', error.message);
    }
    process.exit(1);
});

function shutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully.`);
    server.close(() => {
        mongoose.connection.close(false, () => process.exit(0));
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
