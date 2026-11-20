exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public.community_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES public.users(id),
      details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
      status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'cancelled')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX community_events_owner_idx ON public.community_events(owner_id, id);
    CREATE TABLE public.community_photos (
      id uuid PRIMARY KEY,
      event_id uuid NOT NULL REFERENCES public.community_events(id) ON DELETE CASCADE,
      position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
      content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 500000),
      UNIQUE(event_id, position)
    );
    GRANT SELECT, INSERT ON public.community_events TO sikkim_app;
    GRANT UPDATE(details, status, revision) ON public.community_events TO sikkim_app;
    GRANT SELECT, INSERT, DELETE ON public.community_photos TO sikkim_app;
  `);
};
exports.down = false;
