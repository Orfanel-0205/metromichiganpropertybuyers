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

const { getAllowedOrigins, isAllowedOrigin } = require('./config/origins');

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

// A JWT secret that ships in source is not a secret: anyone who can read this
// repository could mint a valid superadmin token. Development falls back to a
// random per-boot secret (old tokens stop working on restart, which is fine
// locally); production refuses to start rather than run on a guessable key.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') {
        console.error('JWT_SECRET is missing or shorter than 32 characters. Refusing to start.');
        console.error('Generate one with:  openssl rand -hex 48');
        process.exit(1);
    }
    process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
    console.warn('JWT_SECRET not set. Using a temporary development secret; admin sessions end on restart.');
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

const { getLeadNotificationRecipients } = require('./utils/email');
const leadRecipients = getLeadNotificationRecipients();
if (leadRecipients.length) {
    console.log('New lead notifications go to:', leadRecipients.join(', '));
} else {
    console.warn('LEAD_NOTIFICATION_EMAIL is not set. New leads will be saved but nobody will be emailed.');
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
// The allowlist itself lives in config/origins.js so the HTTP server and the
// Socket.IO server below cannot drift apart. See that file for the rules.

const corsOptions = {
    origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) return callback(null, true);

        // Hand back a plain refusal rather than an Error. Passing an Error here
        // routes into the global error handler, which answers 500 with no
        // Access-Control-Allow-Origin header - exactly what a misconfigured
        // origin looked like in production, and impossible to tell apart from a
        // genuine server fault. `false` lets the request continue without CORS
        // headers, and the guard below turns it into an explicit 403.
        console.warn('Blocked CORS request from origin:', origin);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Cache a successful preflight for a day so repeat visitors are not paying
    // an extra round trip to Render (which may be cold) before every POST.
    maxAge: 86400
};

app.use(cors(corsOptions));

// cors() answers preflights on its own, but only for routes that exist. Handling
// OPTIONS explicitly means a preflight for any /api path gets a fast 204 with the
// right headers instead of falling through to the 404 handler.
app.options('*', cors(corsOptions));

// Anything the allowlist refused reaches here without CORS headers. Answer with
// a clear 403 so the cause is legible in logs and in the browser's network tab.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
        return res.status(403).json({
            success: false,
            message: 'Origin not allowed by CORS policy.'
        });
    }
    next();
});

console.log('CORS allowed origins:', getAllowedOrigins().join(', '));
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
    // Same allowlist as the REST API. The previous form passed "true" as the
    // allow flag even when the origin was refused, so every origin was accepted.
    cors: {
        origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
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
        const superAdmins = await Admin.countDocuments({ role: 'superadmin', isActive: true });
        console.log(`Found ${adminCount} admin account(s), ${superAdmins} active Super Admin(s).`);
        if (superAdmins === 0) {
            console.warn('No active Super Admin exists, so nobody can manage admin accounts.');
            console.warn('Run: npm run bootstrap-admin -- --repair');
        }
        return;
    }

    const { ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL } = process.env;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_EMAIL) {
        console.warn('No admin account exists yet. Run "npm run bootstrap-admin" to create the first Super Admin.');
        return;
    }

    // Created as superadmin: the first account has to be able to create the
    // others, and there is no public route that can grant that role.
    await Admin.create({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        email: ADMIN_EMAIL,
        fullName: process.env.ADMIN_FULL_NAME || 'System Administrator',
        role: 'superadmin',
        isActive: true,
        createdBy: 'startup-bootstrap'
    });

    console.log('First Super Admin created from environment credentials.');
    console.log('Admin username:', ADMIN_USERNAME);
    console.log('Admin email:', ADMIN_EMAIL);
    console.warn('ADMIN_PASSWORD is still set in the environment. Remove it once you have signed in.');
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
