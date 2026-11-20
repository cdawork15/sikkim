exports.up = (pgm) => {
  pgm.sql(`
    REVOKE CREATE ON SCHEMA public
    FROM PUBLIC;

    CREATE TABLE public.audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id uuid,
      action varchar(80) NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]*$'),
      entity_type varchar(40) NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]*$'),
      entity_id uuid NOT NULL,
      request_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    COMMENT ON COLUMN public.audit_logs.actor_id
      IS 'Nullable for system actions. Add users foreign key with account migration in issue #2.';

    GRANT USAGE
      ON SCHEMA public
      TO sikkim_app;

    GRANT SELECT, INSERT
      ON public.audit_logs
      TO sikkim_app;

    GRANT SELECT
      ON public.schema_migrations
      TO sikkim_app;
  `);
};
exports.down = false;
