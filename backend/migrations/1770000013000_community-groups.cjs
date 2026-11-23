// Community groups: real joining and a group chat for each Community event.
// - community_members: one row per person per event. Events that need host
//   approval start as 'requested'; the host moves them to 'confirmed'. Free
//   events without approval confirm straight away while places remain,
//   otherwise the person waits ('waiting'). 'declined' is the host's decision;
//   'left' is the member's own.
// - community_messages: the group chat. Only the host and confirmed members
//   can read or post. Posts lock the event row, so ids commit in order and a
//   reader polling with ?after=<id> never skips a message.
exports.up = (pgm) =>
  pgm.sql(`
    CREATE TABLE public.community_members (
      event_id uuid NOT NULL REFERENCES public.community_events (id),
      user_id uuid NOT NULL REFERENCES public.users (id),
      status varchar(12) NOT NULL
        CHECK (status IN ('requested', 'confirmed', 'waiting', 'declined', 'left')),
      decided_by uuid REFERENCES public.users (id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (event_id, user_id)
    );
    CREATE INDEX community_members_user_idx ON public.community_members (user_id, status);
    CREATE INDEX community_members_queue_idx ON public.community_members (event_id, status, updated_at);

    CREATE TABLE public.community_messages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id uuid NOT NULL REFERENCES public.community_events (id),
      author_id uuid NOT NULL REFERENCES public.users (id),
      body varchar(1000) NOT NULL CHECK (length(btrim(body)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX community_messages_event_idx ON public.community_messages (event_id, id);

    GRANT SELECT, INSERT ON public.community_members, public.community_messages TO sikkim_app;
    GRANT UPDATE (status, decided_by, updated_at) ON public.community_members TO sikkim_app;
    GRANT USAGE ON SEQUENCE public.community_messages_id_seq TO sikkim_app;
  `);
exports.down = false;
