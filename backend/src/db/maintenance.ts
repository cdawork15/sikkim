import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { databaseUrl, localDatabaseTarget, type Config } from '../config.js';
import { poolOptions } from './database.js';

function assertSameDatabase(config: Config, migrationUrl: string) {
  const app = databaseUrl(config.connectionString);
  const owner = databaseUrl(migrationUrl);
  if (
    app.hostname !== owner.hostname ||
    (app.port || '5432') !== (owner.port || '5432') ||
    app.pathname !== owner.pathname
  ) {
    throw new Error(
      'Application and migration URLs must target the same database',
    );
  }
}

export const seedId = '00000000-0000-4000-8000-000000000001';

export async function migrate(
  config: Config,
  migrationUrl: string,
  count = Infinity,
) {
  assertSameDatabase(config, migrationUrl);
  const client = new pg.Client(poolOptions(config, migrationUrl));
  await client.connect();
  try {
    await runner({
      dbClient: client,
      dir: fileURLToPath(new URL('../../migrations/', import.meta.url)),
      direction: 'up',
      count,
      migrationsTable: 'schema_migrations',
      singleTransaction: true,
      checkOrder: true,
      log: () => {},
    });
  } finally {
    await client.end();
  }
}

export async function seedOrReset(
  config: Config,
  migrationUrl: string,
  resetConfirmation?: string,
) {
  assertSameDatabase(config, migrationUrl);
  const name = localDatabaseTarget(config.mode, migrationUrl);
  if (resetConfirmation !== undefined && resetConfirmation !== name) {
    throw new Error('Reset requires the exact database name');
  }
  const client = new pg.Client(poolOptions(config, migrationUrl));
  await client.connect();
  try {
    const marker = await client.query<{ marker: string }>(
      `
        SELECT shobj_description(oid, 'pg_database') AS marker
        FROM pg_database
        WHERE datname = current_database()
      `,
    );
    if (marker.rows[0]?.marker !== 'sikkim-local-only') {
      throw new Error('Database is not marked as disposable local data');
    }
    await client.query('BEGIN');
    if (resetConfirmation !== undefined) {
      await client.query(`
        TRUNCATE public.user_reels, public.auth_otp_challenges, public.crm_lead_notes, public.crm_leads, public.community_photos, public.community_events, public.booking_changes, public.tickets, public.bookings,
        public.seat_holds, public.experience_slots, public.story_views,
        public.saved_items,
        public.experience_likes,
        public.story_items,
        public.stories,
        public.experience_media,
        public.media_assets,
        public.experience_categories,
        public.experience_reviews,
        public.recent_searches,
        public.experiences,
        public.policies,
        public.host_verifications,
        public.hosts,
        public.audit_logs,
        public.account_requests,
        public.user_consents,
        public.user_roles,
        public.user_interests,
        public.user_preferences,
        public.auth_sessions,
        public.auth_passwords,
        public.auth_identities,
        public.users
      `);
    }
    await client.query(
      `
        INSERT INTO public.audit_logs (id, action, entity_type, entity_id, request_id)
        VALUES
          ($1, 'demo.seed', 'system', $1, $1)
        ON CONFLICT (id) DO NOTHING
      `,
      [seedId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
