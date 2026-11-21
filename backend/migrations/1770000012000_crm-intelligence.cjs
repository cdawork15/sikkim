// CRM intelligence: lead scoring, tasks, workflow automation and the AI assistant.
// - crm_leads gains the six assessment ratings from the proposal (uniqueness,
//   local story, host readiness, access, safety, photo appeal), an expected
//   monthly booking value for the revenue forecast, and activity timestamps
//   used by the score and pipeline-health reports.
// - crm_tasks: follow-up tasks per lead, written by staff or by the stage playbook.
// - crm_ai_runs: every AI brief that was generated, with model and token usage,
//   so suggestions can be reviewed later and spend can be capped per person.
exports.up = (pgm) =>
  pgm.sql(`
    ALTER TABLE public.crm_leads
      ADD COLUMN score_uniqueness smallint CHECK (score_uniqueness BETWEEN 1 AND 5),
      ADD COLUMN score_story smallint CHECK (score_story BETWEEN 1 AND 5),
      ADD COLUMN score_readiness smallint CHECK (score_readiness BETWEEN 1 AND 5),
      ADD COLUMN score_access smallint CHECK (score_access BETWEEN 1 AND 5),
      ADD COLUMN score_safety smallint CHECK (score_safety BETWEEN 1 AND 5),
      ADD COLUMN score_photo smallint CHECK (score_photo BETWEEN 1 AND 5),
      ADD COLUMN expected_monthly_paise integer
        CHECK (expected_monthly_paise BETWEEN 0 AND 2000000000),
      ADD COLUMN last_activity_at timestamptz,
      ADD COLUMN stage_changed_at timestamptz;

    UPDATE public.crm_leads l
    SET
      last_activity_at = coalesce(
        (SELECT max(n.created_at) FROM public.crm_lead_notes n WHERE n.lead_id = l.id),
        l.updated_at
      ),
      stage_changed_at = coalesce(
        (SELECT max(n.created_at) FROM public.crm_lead_notes n
          WHERE n.lead_id = l.id AND n.kind = 'stage'),
        l.created_at
      );

    ALTER TABLE public.crm_leads
      ALTER COLUMN last_activity_at SET NOT NULL,
      ALTER COLUMN last_activity_at SET DEFAULT clock_timestamp(),
      ALTER COLUMN stage_changed_at SET NOT NULL,
      ALTER COLUMN stage_changed_at SET DEFAULT clock_timestamp();

    CREATE INDEX crm_leads_owner_idx ON public.crm_leads (owner_id, stage)
      WHERE owner_id IS NOT NULL;

    ALTER TABLE public.crm_lead_notes DROP CONSTRAINT crm_lead_notes_kind_check;
    ALTER TABLE public.crm_lead_notes ADD CONSTRAINT crm_lead_notes_kind_check
      CHECK (kind IN ('note', 'call', 'visit', 'message', 'stage', 'task', 'automation', 'ai'));

    CREATE TABLE public.crm_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id uuid NOT NULL REFERENCES public.crm_leads (id),
      title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
      due_on date,
      assignee_id uuid REFERENCES public.users (id),
      status varchar(12) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'done', 'cancelled')),
      source varchar(12) NOT NULL DEFAULT 'staff'
        CHECK (source IN ('staff', 'automation')),
      rule varchar(32) CHECK (rule IS NULL OR rule ~ '^[a-z][a-z0-9_.]*$'),
      created_by uuid NOT NULL REFERENCES public.users (id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      completed_at timestamptz,
      completed_by uuid REFERENCES public.users (id),
      CHECK ((status = 'open') = (completed_at IS NULL)),
      CHECK (source = 'automation' OR rule IS NULL)
    );

    CREATE INDEX crm_tasks_lead_idx ON public.crm_tasks (lead_id, status, due_on);
    CREATE INDEX crm_tasks_open_idx ON public.crm_tasks (assignee_id, due_on)
      WHERE status = 'open';

    CREATE TABLE public.crm_ai_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id uuid NOT NULL REFERENCES public.crm_leads (id),
      requested_by uuid NOT NULL REFERENCES public.users (id),
      provider varchar(16) NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
      model varchar(80) NOT NULL CHECK (length(btrim(model)) > 0),
      result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
      input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
      output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX crm_ai_runs_lead_idx ON public.crm_ai_runs (lead_id, created_at DESC);
    CREATE INDEX crm_ai_runs_user_idx ON public.crm_ai_runs (requested_by, created_at DESC);

    GRANT SELECT, INSERT, UPDATE ON public.crm_tasks TO sikkim_app;
    GRANT SELECT, INSERT ON public.crm_ai_runs TO sikkim_app;
  `);
exports.down = false;
