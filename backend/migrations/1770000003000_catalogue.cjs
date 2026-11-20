exports.up = (pgm) =>
  pgm.sql(`
    CREATE TABLE public.areas (
      code varchar(40) PRIMARY KEY,
      name varchar(80) NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      latitude double precision,
      longitude double precision,
      CHECK (
        (
          latitude IS NULL
          AND longitude IS NULL
        )
        OR (
          latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN -90 AND 90
          AND longitude BETWEEN -180 AND 180
        )
      )
    );

    INSERT INTO public.areas (code, name)
    VALUES
      ('pakyong', 'Pakyong'),
      ('gangtok', 'Gangtok'),
      ('namchi', 'Namchi'),
      ('gyalshing', 'Gyalshing'),
      ('mangan', 'Mangan'),
      ('soreng', 'Soreng');

    CREATE TABLE public.categories (
      code varchar(24) PRIMARY KEY,
      label_key varchar(64) NOT NULL UNIQUE,
      name varchar(80) NOT NULL,
      active boolean NOT NULL DEFAULT true
    );

    INSERT INTO public.categories (code, label_key, name)
    SELECT
      code,
      'categories.' || code,
      label_en
    FROM public.interests;

    CREATE TABLE public.experiences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id uuid NOT NULL REFERENCES public.hosts (id),
      slug varchar(180) NOT NULL UNIQUE,
      title varchar(120) NOT NULL CHECK (length(btrim(title)) > 0),
      description varchar(5000) NOT NULL DEFAULT '',
      area_code varchar(40) REFERENCES public.areas (code),
      meeting_point varchar(1000) NOT NULL DEFAULT '',
      duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 10080),
      price_paise integer CHECK (price_paise >= 0),
      currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
      min_participants integer NOT NULL DEFAULT 1
        CHECK (min_participants BETWEEN 1 AND 1000),
      max_participants integer NOT NULL DEFAULT 10
        CHECK (max_participants BETWEEN 1 AND 1000),
      difficulty varchar(16) NOT NULL DEFAULT 'unknown' CHECK (
        difficulty IN ('unknown', 'easy', 'moderate', 'challenging')
      ),
      inclusions text[] NOT NULL DEFAULT '{}',
      exclusions text[] NOT NULL DEFAULT '{}',
      preparation varchar(2000) NOT NULL DEFAULT '',
      accessibility varchar(16) NOT NULL DEFAULT 'unknown' CHECK (
        accessibility IN ('unknown', 'accessible', 'not_accessible')
      ),
      accessibility_notes varchar(2000) NOT NULL DEFAULT '',
      source_kind varchar(16) NOT NULL DEFAULT 'direct'
        CHECK (source_kind IN ('direct', 'district')),
      source_reference varchar(1000) NOT NULL DEFAULT '',
      status varchar(16) NOT NULL DEFAULT 'draft' CHECK (
        status IN (
          'draft',
          'review',
          'published',
          'rejected',
          'hidden'
        )
      ),
      revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
      featured_rank integer CHECK (featured_rank BETWEEN 0 AND 1000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      published_at timestamptz,
      search_document tsvector GENERATED ALWAYS AS (
        to_tsvector(
          'simple',
          title || ' ' || description || ' ' || meeting_point || ' ' || COALESCE(area_code, '')
        )
      ) STORED,
      CHECK (min_participants <= max_participants),
      CHECK (
        cardinality(inclusions) <= 30
        AND cardinality(exclusions) <= 30
      )
    );

    CREATE TABLE public.experience_categories (
      experience_id uuid NOT NULL REFERENCES public.experiences (id),
      category_code varchar(24) NOT NULL REFERENCES public.categories (code),
      PRIMARY KEY (experience_id, category_code)
    );

    CREATE INDEX experience_categories_filter_idx
      ON public.experience_categories (category_code, experience_id);

    CREATE TABLE public.policies (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      experience_id uuid NOT NULL REFERENCES public.experiences (id),
      version integer NOT NULL CHECK (version > 0),
      cancellation varchar(3000) NOT NULL CHECK (length(btrim(cancellation)) > 0),
      safety varchar(3000) NOT NULL CHECK (length(btrim(safety)) > 0),
      participation varchar(3000) NOT NULL CHECK (length(btrim(participation)) > 0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (experience_id, version),
      UNIQUE (experience_id, id)
    );

    ALTER TABLE public.experiences
      ADD COLUMN policy_id uuid;

    ALTER TABLE public.experiences
      ADD CONSTRAINT experiences_policy_fk
      FOREIGN KEY (id, policy_id)
      REFERENCES public.policies (experience_id, id);

    CREATE TABLE public.experience_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      experience_id uuid NOT NULL REFERENCES public.experiences (id),
      revision integer NOT NULL,
      action varchar(16) NOT NULL CHECK (
        action IN ('submitted', 'published', 'rejected', 'hidden')
      ),
      actor_id uuid NOT NULL REFERENCES public.users (id),
      reason varchar(1000),
      provider_reference varchar(1000),
      source_verified boolean NOT NULL DEFAULT false,
      snapshot jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (experience_id, revision),
      CHECK (
        action = 'submitted'
        OR (
          reason IS NOT NULL
          AND length(btrim(reason)) > 0
        )
      )
    );

    CREATE TABLE public.recent_searches (
      user_id uuid NOT NULL REFERENCES public.users (id),
      query varchar(120) NOT NULL CHECK (length(btrim(query)) > 0),
      searched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (user_id, query)
    );

    CREATE INDEX recent_searches_user_time_idx
      ON public.recent_searches (user_id, searched_at DESC);

    ALTER TABLE public.user_preferences
      ADD COLUMN search_filters jsonb NOT NULL DEFAULT '{}'
      CHECK (jsonb_typeof(search_filters) = 'object');

    CREATE INDEX experiences_host_idx ON public.experiences (host_id, id);

    CREATE INDEX experiences_review_idx ON public.experiences (status, id);

    CREATE INDEX experiences_search_idx ON public.experiences USING gin (search_document)
    WHERE status = 'published';

    CREATE INDEX experiences_price_idx ON public.experiences (price_paise, id)
    WHERE status = 'published';

    CREATE INDEX experiences_area_price_idx
      ON public.experiences (area_code, price_paise, id)
    WHERE status = 'published';

    CREATE INDEX experiences_recommended_idx
      ON public.experiences ((COALESCE(featured_rank, 1001)), id)
    WHERE status = 'published';

    CREATE INDEX experiences_accessibility_idx ON public.experiences (accessibility, id)
    WHERE status = 'published';

    CREATE INDEX experiences_title_prefix_idx
      ON public.experiences (lower(title) text_pattern_ops)
    WHERE status = 'published';

    GRANT SELECT
      ON public.areas,
        public.categories
      TO sikkim_app;

    GRANT SELECT, INSERT, UPDATE
      ON public.experiences
      TO sikkim_app;

    GRANT SELECT, INSERT, DELETE
      ON public.experience_categories,
        public.recent_searches
      TO sikkim_app;

    GRANT UPDATE (searched_at)
      ON public.recent_searches
      TO sikkim_app;

    GRANT SELECT, INSERT
      ON public.policies,
        public.experience_reviews
      TO sikkim_app;
  `);
exports.down = false;
