exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name varchar(80) NOT NULL CHECK (length(btrim(display_name)) > 0),
      language varchar(2) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'ne')),
      status varchar(24) NOT NULL DEFAULT 'active' CHECK (
        status IN (
          'active',
          'suspended',
          'deletion_requested',
          'deleted'
        )
      ),
      is_demo boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE public.auth_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users (id),
      provider varchar(40) NOT NULL,
      subject varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (provider, subject)
    );

    CREATE INDEX auth_identities_user_idx ON public.auth_identities (user_id);

    CREATE TABLE public.auth_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users (id),
      token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at timestamptz NOT NULL,
      absolute_expires_at timestamptz NOT NULL,
      CHECK (expires_at <= absolute_expires_at)
    );

    CREATE INDEX auth_sessions_user_idx ON public.auth_sessions (user_id, created_at);

    CREATE INDEX auth_sessions_expiry_idx ON public.auth_sessions (expires_at);

    CREATE TABLE public.user_preferences (
      user_id uuid PRIMARY KEY REFERENCES public.users (id),
      chosen_area varchar(80) CHECK (
        chosen_area IS NULL
        OR length(btrim(chosen_area)) > 0
      ),
      trip_start date,
      trip_days smallint CHECK (trip_days BETWEEN 2 AND 10),
      travellers smallint NOT NULL DEFAULT 1 CHECK (travellers BETWEEN 1 AND 10),
      pace varchar(10) NOT NULL DEFAULT 'balanced' CHECK (pace IN ('slow', 'balanced')),
      notifications_enabled boolean NOT NULL DEFAULT false,
      show_in_participant_list boolean NOT NULL DEFAULT false
    );

    CREATE TABLE public.interests (
      code varchar(24) PRIMARY KEY,
      label_key varchar(64) NOT NULL UNIQUE,
      label_en varchar(80) NOT NULL,
      sort_order smallint NOT NULL UNIQUE
    );

    INSERT INTO public.interests (code, label_key, label_en, sort_order)
    VALUES
      (
        'hiking',
        'interests.hiking',
        'Hiking & trails',
        1
      ),
      ('nature', 'interests.nature', 'Nature', 2),
      ('culture', 'interests.culture', 'Culture', 3),
      ('food', 'interests.food', 'Food & drink', 4),
      (
        'wellness',
        'interests.wellness',
        'Slow living',
        5
      ),
      ('art', 'interests.art', 'Art', 6),
      ('music', 'interests.music', 'Music', 7);

    CREATE TABLE public.user_interests (
      user_id uuid NOT NULL REFERENCES public.users (id),
      interest_code varchar(24) NOT NULL REFERENCES public.interests (code),
      PRIMARY KEY (user_id, interest_code)
    );

    CREATE TABLE public.user_consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users (id),
      purpose varchar(24) NOT NULL CHECK (purpose IN ('personalisation', 'marketing')),
      policy_version varchar(40) NOT NULL,
      accepted boolean NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX user_consents_latest_idx
      ON public.user_consents (user_id, purpose, recorded_at DESC);

    CREATE TABLE public.user_roles (
      user_id uuid NOT NULL REFERENCES public.users (id),
      role varchar(16) NOT NULL CHECK (role IN ('host', 'admin')),
      assigned_by uuid REFERENCES public.users (id),
      assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE public.account_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users (id),
      type varchar(16) NOT NULL CHECK (type = 'deletion'),
      status varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'rejected')),
      requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, type)
    );

    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_actor_fk
      FOREIGN KEY (actor_id)
      REFERENCES public.users (id) ON DELETE SET NULL;

    COMMENT ON COLUMN public.audit_logs.actor_id
      IS 'Account performing the action; NULL for system actions.';

    GRANT SELECT, INSERT
      ON public.users,
        public.auth_identities,
        public.user_preferences,
        public.user_consents,
        public.account_requests
      TO sikkim_app;

    GRANT UPDATE (display_name, language, status, updated_at)
      ON public.users
      TO sikkim_app;

    GRANT UPDATE
      ON public.user_preferences
      TO sikkim_app;

    GRANT SELECT, INSERT, UPDATE, DELETE
      ON public.auth_sessions
      TO sikkim_app;

    GRANT SELECT, INSERT, DELETE
      ON public.user_interests
      TO sikkim_app;

    GRANT SELECT
      ON public.interests,
        public.user_roles
      TO sikkim_app;
  `);
};
exports.down = false;
