const dns = require('dns');

const DEFAULT_DNS_SERVERS = ['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4'];

function sanitizeErrorMessage(message) {
    return String(message || '').replace(
        /mongodb(\+srv)?:\/\/([^:@/\s]+):([^@/\s]*)@/gi,
        'mongodb$1://<credentials>@'
    );
}

function validateMongoUri(rawUri) {
    const uri = (rawUri || '').trim();

    if (!uri) {
        throw new Error('MONGODB_URI is not set.');
    }

    if (/[<>]/.test(uri)) {
        throw new Error('MONGODB_URI contains angle brackets. Remove placeholder brackets from the username/password.');
    }

    let parsed;
    try {
        parsed = new URL(uri);
    } catch (error) {
        throw new Error(`MONGODB_URI is not a valid MongoDB connection string: ${error.message}`);
    }

    if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
        throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://.');
    }

    if (!parsed.username || !parsed.password) {
        throw new Error('MONGODB_URI must include MongoDB Atlas username and password credentials.');
    }

    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!databaseName) {
        throw new Error('MONGODB_URI must include the application database name.');
    }

    return {
        uri,
        isSrv: parsed.protocol === 'mongodb+srv:',
        host: parsed.host,
        databaseName
    };
}

function configureMongoDns(isSrvUri) {
    if (!isSrvUri) {
        return { changed: false, servers: dns.getServers() };
    }

    const configuredServers = (process.env.MONGODB_DNS_SERVERS || '')
        .split(',')
        .map((server) => server.trim())
        .filter(Boolean);

    const servers = configuredServers.length > 0 ? configuredServers : DEFAULT_DNS_SERVERS;

    dns.setServers(servers);
    if (dns.setDefaultResultOrder) {
        dns.setDefaultResultOrder('ipv4first');
    }

    return { changed: true, servers: dns.getServers() };
}

function getMongooseConnectOptions() {
    return {
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 0
    };
}

function getTroubleshootingHints(error, isSrvUri) {
    const message = sanitizeErrorMessage(error && error.message);
    const hints = [];

    if (isSrvUri && /querySrv|ECONNREFUSED|ETIMEOUT|ENOTFOUND|ENODATA/i.test(message)) {
        hints.push('Node.js DNS SRV lookup failed. The app uses configured DNS servers from MONGODB_DNS_SERVERS or Cloudflare/Google defaults.');
        hints.push('If this still fails, change Windows adapter DNS to a resolver that supports SRV records, then flush DNS.');
    }

    if (/authentication failed|bad auth|auth failed/i.test(message)) {
        hints.push('MongoDB authentication failed. Verify the Atlas database user and URL-encode reserved characters in the password.');
    }

    if (/server selection timed out|timed out|SSL|TLS|ECONNREFUSED/i.test(message)) {
        hints.push('If DNS succeeds but connection times out, verify MongoDB Atlas Network Access allows your current public IP address.');
    }

    hints.push('Do not add 0.0.0.0/0 permanently; add the narrow current IP/CIDR needed for this machine or host.');
    return hints;
}

module.exports = {
    configureMongoDns,
    getMongooseConnectOptions,
    getTroubleshootingHints,
    sanitizeErrorMessage,
    validateMongoUri
};
