// Three account types, passwordless sign-in and reels from everyone.
// - user_roles: adds 'super' (sees everything). 'admin' manages trips and reviews.
// - auth_otp_challenges: one-time codes sent by email or SMS. Codes are stored
//   only as HMAC hashes; attempts and expiry are enforced in SQL.
// - host_verifications.method: 'staff' for admins who host trips themselves.
// - user_reels: short videos any signed-in person can share; an admin approves
//   the video (media moderation) before it appears in Explore.
exports.up = (pgm) =>
  pgm.sql(`
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check;
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_role_check CHECK (role IN ('host', 'admin', 'super'));

    ALTER TABLE public.host_verifications DROP CONSTRAINT host_verifications_method_check;
    ALTER TABLE public.host_verifications
      ADD CONSTRAINT host_verifications_method_check
        CHECK (method IN ('in_person', 'video_call', 'document', 'staff'));

    CREATE TABLE public.auth_otp_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel varchar(8) NOT NULL CHECK (channel IN ('email', 'phone')),
      destination varchar(254) NOT NULL CHECK (length(destination) > 3),
      code_hash char(64) NOT NULL,
      attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX auth_otp_challenges_destination_idx
      ON public.auth_otp_challenges (channel, destination, created_at DESC);

    CREATE TABLE public.user_reels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users (id),
      asset_id uuid NOT NULL UNIQUE REFERENCES public.media_assets (id),
      caption varchar(300) NOT NULL DEFAULT '',
      place varchar(120) NOT NULL DEFAULT '',
      experience_id uuid REFERENCES public.experiences (id),
      status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX user_reels_feed_idx ON public.user_reels (created_at DESC, id DESC)
      WHERE status = 'active';
    CREATE INDEX user_reels_owner_idx ON public.user_reels (user_id, created_at DESC);

    GRANT SELECT, INSERT, UPDATE ON public.auth_otp_challenges TO sikkim_app;
    GRANT SELECT, INSERT, UPDATE ON public.user_reels TO sikkim_app;
  `);
exports.down = false;
