//backend/utils/leadContacts.js
// ===========================
// LEAD CONTACT MIRROR (Supabase)
// ===========================
// Copies only the visitor's personal/contact fields into Supabase. Deliberately
// excludes status, priority, notes, tracking, and SMS conversation data.
//
// Field mapping, taken from backend/models/Lead.js:
//   fullName        -> full_name
//   email           -> email
//   phone           -> phone
//   propertyAddress -> property_address
//   _id             -> mongo_lead_id

const { getSupabaseClient } = require('./supabase');

const TABLE = 'lead_contacts';

// A refused connection fails in milliseconds, but a Supabase that accepts the
// socket and then stalls would otherwise hold the visitor's response open
// indefinitely. Cap it.
const MIRROR_TIMEOUT_MS = parseInt(process.env.SUPABASE_TIMEOUT_MS, 10) || 5000;

/**
 * Best-effort mirror of one lead's contact details.
 * Never throws: returns true on insert, false when skipped or failed.
 */
async function mirrorLeadContact(lead) {
    try {
        const supabase = getSupabaseClient();
        if (!supabase) return false;

        const row = {
            mongo_lead_id: String(lead._id),
            full_name: lead.fullName,
            email: lead.email,
            phone: lead.phone,
            property_address: lead.propertyAddress
        };

        const { error } = await supabase
            .from(TABLE)
            .insert(row)
            .abortSignal(AbortSignal.timeout(MIRROR_TIMEOUT_MS));

        if (error) {
            // A PostgREST error is returned, not thrown.
            console.error(`Supabase lead mirror failed for ${row.mongo_lead_id}:`, error.message);
            return false;
        }

        console.log(`Supabase lead contact mirrored: ${row.mongo_lead_id}`);
        return true;

    } catch (error) {
        // Network failure, bad URL, malformed key, anything else.
        console.error('Supabase lead mirror error:', error.message);
        return false;
    }
}

module.exports = { mirrorLeadContact, LEAD_CONTACTS_TABLE: TABLE };
