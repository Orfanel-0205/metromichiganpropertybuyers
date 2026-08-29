//backend/utils/supabase.js
// ===========================
// SUPABASE CLIENT
// ===========================
// Secondary, best-effort store for lead contact details. MongoDB remains the
// source of truth; nothing here may ever block or fail a lead submission.
//
// SUPABASE_SECRET_KEY is the service-role key. It bypasses row level security,
// so it is backend-only and must never reach the browser.

const { createClient } = require('@supabase/supabase-js');
const WebSocketImpl = require('ws');

let client = null;
let warned = false;

/**
 * Returns the shared Supabase client, or null when the integration is not
 * configured. Callers treat null as "skip the secondary write".
 */
function getSupabaseClient() {
    if (client) return client;

    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;

    if (!url || !secretKey) {
        if (!warned) {
            console.warn('Supabase not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing). Lead contact mirroring is disabled.');
            warned = true;
        }
        return null;
    }

    client = createClient(url, secretKey, {
        auth: {
            // No end-user sessions on the server: never persist or refresh tokens.
            persistSession: false,
            autoRefreshToken: false
        },
        realtime: {
            // createClient builds a Realtime client eagerly and throws on Node < 22,
            // which has no global WebSocket. We never use Realtime, but the check
            // runs regardless, so hand it an implementation.
            transport: WebSocketImpl
        }
    });

    return client;
}

function isSupabaseConfigured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

module.exports = { getSupabaseClient, isSupabaseConfigured };
