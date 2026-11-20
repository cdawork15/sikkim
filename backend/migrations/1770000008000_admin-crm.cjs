// Admin workspace and curator CRM.
// - crm_leads: the curator/experience pipeline (replaces the pilot spreadsheet).
// - crm_lead_notes: append-only activity log per lead (calls, visits, notes, stage changes).
// - host_verifications.method: how an admin checked a real host's identity.
// Roles stay outside the app role's privileges: admins are granted only by the
// operator command (npm run admin), so a compromised API cannot escalate.
exports.up = (pgm) =>
  pgm.sql(`
    CREATE TABLE public.crm_leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(16) UNIQUE CHECK (code ~ '^[A-Z]{2,5}-[0-9]{1,4}$'),
      name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
      experience_idea varchar(200) NOT NULL DEFAULT '',
      district varchar(40) NOT NULL DEFAULT '',
      locality varchar(80) NOT NULL DEFAULT '',
      category_code varchar(24) REFERENCES public.categories (code),
      contact_name varchar(80) NOT NULL DEFAULT '',
      phone varchar(20) NOT NULL DEFAULT ''
        CHECK (phone = '' OR phone ~ '^\\+?[0-9][0-9 ()-]{6,19}$'),
      email varchar(254) NOT NULL DEFAULT '',
      contact_source varchar(200) NOT NULL DEFAULT '',
      contact_confirmed boolean NOT NULL DEFAULT false,
      stage varchar(24) NOT NULL DEFAULT 'idea' CHECK (
        stage IN (
          'idea',
          'contacted',
          'interested',
          'agreement_sent',
          'agreed',
          'onboarding',
          'live',
          'paused',
          'declined'
        )
      ),
      verdict varchar(16) NOT NULL DEFAULT 'undecided'
        CHECK (verdict IN ('undecided', 'list_in_pilot', 'later', 'not_suitable')),
      site_visit varchar(16) NOT NULL DEFAULT 'not_needed'
        CHECK (site_visit IN ('not_needed', 'pending', 'done')),
      media_received boolean NOT NULL DEFAULT false,
      rights_confirmed boolean NOT NULL DEFAULT false,
      agreement_signed boolean NOT NULL DEFAULT false,
      writeup_final boolean NOT NULL DEFAULT false,
      owner_id uuid REFERENCES public.users (id),
      host_id uuid UNIQUE REFERENCES public.hosts (id),
      next_follow_up date,
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_by uuid NOT NULL REFERENCES public.users (id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX crm_leads_recent_idx ON public.crm_leads (created_at DESC, id DESC);
    CREATE INDEX crm_leads_stage_idx ON public.crm_leads (stage, created_at DESC, id DESC);
    CREATE INDEX crm_leads_follow_up_idx ON public.crm_leads (next_follow_up)
      WHERE next_follow_up IS NOT NULL;

    CREATE TABLE public.crm_lead_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id uuid NOT NULL REFERENCES public.crm_leads (id),
      author_id uuid NOT NULL REFERENCES public.users (id),
      kind varchar(16) NOT NULL CHECK (kind IN ('note', 'call', 'visit', 'message', 'stage')),
      body varchar(2000) NOT NULL CHECK (length(btrim(body)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX crm_lead_notes_lead_idx
      ON public.crm_lead_notes (lead_id, created_at DESC, id DESC);

    ALTER TABLE public.host_verifications
      ADD COLUMN method varchar(16)
        CHECK (method IN ('in_person', 'video_call', 'document'));

    GRANT SELECT, INSERT, UPDATE ON public.crm_leads TO sikkim_app;
    GRANT SELECT, INSERT ON public.crm_lead_notes TO sikkim_app;
  `);
exports.down = false;
