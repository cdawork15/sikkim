exports.up = (pgm) =>
  pgm.sql(`
    CREATE TABLE public.media_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id uuid NOT NULL REFERENCES public.users(id),
      purpose varchar(24) NOT NULL
        CHECK (purpose IN ('public_content', 'private_evidence')),
      kind varchar(8) NOT NULL CHECK (kind IN ('image', 'video')),
      content_type varchar(32) NOT NULL CHECK (
        content_type IN (
          'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'
        )
      ),
      expected_bytes integer NOT NULL
        CHECK (expected_bytes BETWEEN 1 AND 52428800),
      state varchar(20) NOT NULL DEFAULT 'pending' CHECK (
        state IN (
          'pending', 'uploading', 'processing', 'ready', 'failed', 'deleted'
        )
      ),
      moderation varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (moderation IN ('pending', 'approved', 'rejected')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      author varchar(160) NOT NULL,
      source_url varchar(2000) NOT NULL,
      licence_url varchar(2000) NOT NULL,
      permission_note varchar(2000) NOT NULL,
      place varchar(160) NOT NULL,
      alt_text varchar(500) NOT NULL,
      captions text NOT NULL DEFAULT '' CHECK (length(captions) <= 20000),
      variants jsonb NOT NULL DEFAULT '{}'
        CHECK (jsonb_typeof(variants) = 'object'),
      failure_code varchar(40),
      review_reason varchar(1000),
      reviewed_by uuid REFERENCES public.users(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      uploaded_at timestamptz,
      processing_started_at timestamptz,
      CHECK (kind = 'video' OR expected_bytes <= 10485760),
      CHECK (
        (kind = 'image' AND content_type LIKE 'image/%')
        OR (kind = 'video' AND content_type LIKE 'video/%')
      ),
      CHECK (purpose <> 'private_evidence' OR kind = 'image')
    );

    CREATE INDEX media_assets_owner_idx
      ON public.media_assets (owner_id, id);
    CREATE INDEX media_assets_work_idx
      ON public.media_assets (state, processing_started_at);

    CREATE TABLE public.experience_media (
      experience_id uuid NOT NULL REFERENCES public.experiences(id),
      asset_id uuid NOT NULL REFERENCES public.media_assets(id),
      position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
      purpose varchar(8) NOT NULL
        CHECK (purpose IN ('gallery', 'cover', 'reel')),
      PRIMARY KEY (experience_id, asset_id),
      UNIQUE (experience_id, position)
    );

    CREATE UNIQUE INDEX experience_media_cover_idx
      ON public.experience_media (experience_id)
      WHERE purpose = 'cover';
    CREATE UNIQUE INDEX experience_media_reel_idx
      ON public.experience_media (experience_id)
      WHERE purpose = 'reel';
    CREATE INDEX experience_media_asset_idx
      ON public.experience_media (asset_id);

    CREATE TABLE public.stories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id uuid NOT NULL REFERENCES public.hosts(id),
      title varchar(120) NOT NULL CHECK (length(btrim(title)) > 0),
      status varchar(16) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'hidden')),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      published_at timestamptz,
      expires_at timestamptz,
      CHECK (
        status <> 'published'
        OR (
          published_at IS NOT NULL
          AND expires_at IS NOT NULL
          AND expires_at > published_at
          AND expires_at <= published_at + interval '24 hours'
        )
      )
    );

    CREATE INDEX stories_host_idx ON public.stories (host_id, id);
    CREATE INDEX stories_public_idx
      ON public.stories (expires_at, id)
      WHERE status = 'published';

    CREATE TABLE public.story_items (
      story_id uuid NOT NULL REFERENCES public.stories(id),
      asset_id uuid NOT NULL REFERENCES public.media_assets(id),
      position smallint NOT NULL CHECK (position BETWEEN 0 AND 7),
      caption varchar(500) NOT NULL DEFAULT '',
      PRIMARY KEY (story_id, position),
      UNIQUE (story_id, asset_id)
    );

    CREATE INDEX story_items_asset_idx ON public.story_items (asset_id);

    CREATE TABLE public.saved_items (
      user_id uuid NOT NULL REFERENCES public.users(id),
      experience_id uuid NOT NULL REFERENCES public.experiences(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (user_id, experience_id)
    );

    CREATE TABLE public.experience_likes (
      user_id uuid NOT NULL REFERENCES public.users(id),
      experience_id uuid NOT NULL REFERENCES public.experiences(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (user_id, experience_id)
    );

    CREATE INDEX experience_likes_experience_idx
      ON public.experience_likes (experience_id);

    CREATE TABLE public.story_views (
      user_id uuid NOT NULL REFERENCES public.users(id),
      story_id uuid NOT NULL REFERENCES public.stories(id),
      seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (user_id, story_id)
    );

    GRANT SELECT, INSERT, UPDATE
      ON public.media_assets, public.stories
      TO sikkim_app;
    GRANT SELECT, INSERT, DELETE
      ON public.experience_media,
        public.story_items,
        public.saved_items,
        public.experience_likes,
        public.story_views
      TO sikkim_app;
  `);

exports.down = false;
