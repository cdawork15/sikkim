exports.up = (pgm) =>
  pgm.sql(`
    CREATE TABLE public.hosts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE REFERENCES public.users (id),
      public_name varchar(80) NOT NULL DEFAULT '',
      story varchar(2000) NOT NULL DEFAULT '',
      service_areas varchar(80) [] NOT NULL DEFAULT '{}',
      contact_choice varchar(12) NOT NULL DEFAULT 'hidden'
        CHECK (contact_choice IN ('hidden', 'in_app')),
      status varchar(16) NOT NULL DEFAULT 'draft' CHECK (
        status IN (
          'draft',
          'pending',
          'approved',
          'rejected',
          'suspended'
        )
      ),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      approved_until timestamptz,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (cardinality(service_areas) <= 10)
    );

    CREATE INDEX hosts_status_id_idx ON public.hosts (status, id);

    CREATE TABLE public.host_verifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id uuid NOT NULL REFERENCES public.hosts (id),
      revision integer NOT NULL,
      action varchar(16) NOT NULL CHECK (
        action IN ('submitted', 'approved', 'rejected', 'suspended')
      ),
      actor_id uuid NOT NULL REFERENCES public.users (id),
      reason varchar(1000),
      snapshot jsonb NOT NULL,
      expires_at timestamptz,
      is_demo boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (host_id, revision),
      CHECK (
        action = 'submitted'
        OR (
          reason IS NOT NULL
          AND length(btrim(reason)) > 0
        )
      )
    );

    CREATE INDEX host_verifications_host_idx
      ON public.host_verifications (host_id, revision DESC);

    GRANT SELECT, INSERT, UPDATE
      ON public.hosts
      TO sikkim_app;

    GRANT SELECT, INSERT
      ON public.host_verifications
      TO sikkim_app;
  `);
exports.down = false;
