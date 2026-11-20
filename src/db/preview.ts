import pg from 'pg';
import { databaseUrl, localDatabaseTarget, type Config } from '../config.js';
import { poolOptions } from './database.js';

// Opt-in visual fixtures, never production offers. These accounts have no login
// identities or roles. Published fixtures model the future verified-host path;
// demo travellers still cannot publish through the API.
const hosts = [
  ['Mountain mornings', 'Pakyong'],
  ['The local kitchen', 'Gangtok'],
  ['Quiet trails', 'Soreng'],
  ['Culture & craft', 'Namchi'],
] as const;
const experiences = [
  [
    'sunrise-in-the-himalayas',
    'Sunrise in the Himalayas',
    'pakyong',
    0,
    150,
    120000,
    ['nature', 'hiking'],
    'Watch the first light reach the mountains, then share a warm cup of tea.',
  ],
  [
    'taste-a-little-of-sikkim',
    'Taste a little of Sikkim',
    'gangtok',
    1,
    150,
    90000,
    ['food'],
    'Fold momos, hear kitchen stories and sit down to a shared meal.',
  ],
  [
    'forest-paths-slow-mornings',
    'Forest paths, slow mornings',
    'soreng',
    2,
    180,
    75000,
    ['nature', 'wellness'],
    'Take an unhurried woodland walk and make room for a quieter morning.',
  ],
  [
    'monastery-stories',
    'A morning of monastery stories',
    'gangtok',
    3,
    120,
    60000,
    ['culture'],
    'Explore local traditions and architectural details with a patient storyteller.',
  ],
  [
    'pakyong-village-walk',
    'Walk a little further in Pakyong',
    'pakyong',
    0,
    120,
    55000,
    ['hiking', 'culture'],
    'Follow village lanes and discover the small stories between the viewpoints.',
  ],
  [
    'tea-and-mountain-views',
    'Tea with a mountain view',
    'namchi',
    1,
    90,
    45000,
    ['food', 'wellness'],
    'A slow afternoon built around tea, conversation and the landscape.',
  ],
  [
    'hands-on-local-craft',
    'Make something to remember',
    'namchi',
    3,
    120,
    110000,
    ['art', 'culture'],
    'Spend an afternoon exploring patterns and making a simple craft keepsake.',
  ],
  [
    'voices-of-the-hills',
    'Songs and stories of the hills',
    'gyalshing',
    3,
    90,
    80000,
    ['music', 'culture'],
    'An intimate introduction to local songs and the stories that travel with them.',
  ],
  [
    'ridge-walk',
    'The long way to the view',
    'mangan',
    0,
    240,
    160000,
    ['hiking', 'nature'],
    'A longer hillside walk with time to stop, breathe and take in the valley.',
  ],
  [
    'garden-to-table',
    'From the garden to the table',
    'pakyong',
    1,
    180,
    130000,
    ['food', 'nature'],
    'Meet familiar ingredients in the garden before preparing a seasonal meal.',
  ],
  [
    'slow-sunday-soreng',
    'A slow Sunday in Soreng',
    'soreng',
    2,
    120,
    65000,
    ['wellness', 'nature'],
    'Leave the rush behind for gentle walking and a peaceful outdoor break.',
  ],
  [
    'evening-in-gangtok',
    'An evening around Gangtok',
    'gangtok',
    3,
    120,
    70000,
    ['culture', 'food'],
    'Explore neighbourhood corners and the flavours that bring an evening to life.',
  ],
] as const;
const id = (group: number, index: number) =>
  `d37e0000-0000-4000-8000-${String(group * 1000 + index).padStart(12, '0')}`;

export async function seedPreview(config: Config, migrationUrl: string) {
  if (config.mode !== 'development' || !config.demoAuth) {
    throw new Error(
      'Preview data requires local development with demo auth enabled',
    );
  }
  localDatabaseTarget(config.mode, config.connectionString);
  localDatabaseTarget(config.mode, migrationUrl);
  const app = databaseUrl(config.connectionString);
  const owner = databaseUrl(migrationUrl);
  if (
    app.hostname !== owner.hostname ||
    app.port !== owner.port ||
    app.pathname !== owner.pathname
  ) {
    throw new Error('Database targets must match');
  }
  const client = new pg.Client(poolOptions(config, migrationUrl));
  await client.connect();
  try {
    const marker = await client.query(
      `
        SELECT shobj_description(oid, 'pg_database') AS marker
        FROM pg_database
        WHERE datname = current_database()
      `,
    );
    if (marker.rows[0]?.marker !== 'sikkim-local-only') {
      throw new Error('Preview data requires a marked local database');
    }
    await client.query('BEGIN');
    for (const [index, [name, area]] of hosts.entries()) {
      await client.query(
        `
          INSERT INTO public.users (id, display_name, is_demo)
          VALUES
            ($1, $2, false)
          ON CONFLICT (id) DO NOTHING
        `,
        [id(1, index), `Preview · ${name}`],
      );
      await client.query(
        `
          INSERT INTO public.hosts (
              id,
              user_id,
              public_name,
              story,
              service_areas,
              status,
              approved_until
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              'approved',
              clock_timestamp() + interval '90 days'
            )
          ON CONFLICT (id) DO NOTHING
        `,
        [
          id(2, index),
          id(1, index),
          `Preview · ${name}`,
          'Fictional host for local design preview only. This is not a ' +
            'verified provider or a bookable offer.',
          [area],
        ],
      );
    }
    for (const [
      index,
      [slug, title, area, host, minutes, price, categories, description],
    ] of experiences.entries()) {
      const result = await client.query(
        `
          INSERT INTO public.experiences (
              id,
              host_id,
              slug,
              title,
              description,
              area_code,
              meeting_point,
              duration_minutes,
              price_paise,
              max_participants,
              difficulty,
              inclusions,
              exclusions,
              preparation,
              accessibility_notes,
              source_reference,
              status,
              featured_rank,
              published_at
            )
          VALUES
            (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9,
              8,
              'easy',
              $10,
              $11,
              $12,
              $13,
              'local-design-preview',
              'published',
              $14,
              clock_timestamp()
            )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `,
        [
          id(3, index),
          id(2, host),
          `preview-${slug}`,
          title,
          `Design preview only — not a real offer. ${description}`,
          area,
          'Sample meeting point. Do not travel based on this preview.',
          minutes,
          price,
          ['Sample local guide', 'Sample refreshments'],
          ['Transport', 'Personal purchases'],
          'Preview information only. Confirm all arrangements when real bookings become available.',
          'Accessibility has not been assessed for this fictional listing.',
          index < 3 ? index : null,
        ],
      );
      if (!result.rowCount) {
        continue;
      }
      await client.query(
        `
          INSERT INTO public.policies (
              id,
              experience_id,
              version,
              cancellation,
              safety,
              participation
            )
          VALUES
            ($1, $2, 1, $3, $4, $5)
        `,
        [
          id(4, index),
          id(3, index),
          'Preview only. No payment or reservation is accepted.',
          'This fictional listing has not been safety-verified. Do not use it to plan an activity.',
          'Sample group size and price for interface testing only.',
        ],
      );
      await client.query(
        'UPDATE public.experiences SET policy_id=$2 WHERE id=$1',
        [id(3, index), id(4, index)],
      );
      await client.query(
        `
          INSERT INTO public.experience_categories (experience_id, category_code)
          SELECT
            $1,
            unnest($2::text[])
        `,
        [id(3, index), categories],
      );
    }
    await client.query(
      `
        INSERT INTO public.audit_logs (id, action, entity_type, entity_id, request_id)
        VALUES
          ($1, 'preview.seed', 'system', $1, $1)
        ON CONFLICT (id) DO NOTHING
      `,
      [id(5, 0)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
