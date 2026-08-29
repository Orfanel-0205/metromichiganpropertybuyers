-- ===========================================================================
-- lead_contacts
-- ===========================================================================
-- Secondary store for the personal/contact fields of a lead. MongoDB remains
-- the source of truth; this table is a best-effort mirror written by
-- backend/utils/leadContacts.js after POST /api/leads saves the Mongo document.
--
-- Column names mirror backend/models/Lead.js:
--   fullName        -> full_name
--   email           -> email
--   phone           -> phone
--   propertyAddress -> property_address
--   _id             -> mongo_lead_id
--
-- Deliberately excluded: status, priority, notes, tracking, smsConversation,
-- smsConsent, and every property-detail field other than the address.
--
-- Run this in the Supabase SQL editor.
-- ===========================================================================

create table if not exists public.lead_contacts (
  id               uuid primary key default gen_random_uuid(),
  mongo_lead_id    text not null,
  full_name        text,
  email            text,
  phone            text,
  property_address text,
  created_at       timestamptz not null default now()
);

-- One mirror row per Mongo document. Makes cross-referencing unambiguous and
-- stops a retried submission from writing the same contact twice.
create unique index if not exists lead_contacts_mongo_lead_id_key
  on public.lead_contacts (mongo_lead_id);

-- Supports "most recent contacts first" reads.
create index if not exists lead_contacts_created_at_idx
  on public.lead_contacts (created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- This table holds customer PII. Enable RLS and define NO policies: the
-- service-role key the backend uses bypasses RLS, while the anon and
-- authenticated roles are denied outright. Without this, anyone holding the
-- publishable key could read every contact record.

alter table public.lead_contacts enable row level security;

-- Belt and braces: revoke the default grants the API roles get.
revoke all on public.lead_contacts from anon, authenticated;
