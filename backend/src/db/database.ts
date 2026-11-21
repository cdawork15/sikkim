import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Config } from '../config.js';

export const latestMigration = '1770000011000_camera-videos';

export function poolOptions(
  config: Config,
  connectionString = config.connectionString,
): pg.PoolConfig {
  return {
    connectionString,
    ssl: config.databaseTls
      ? {
          rejectUnauthorized: true,
          ...(config.databaseCaFile
            ? { ca: readFileSync(config.databaseCaFile, 'utf8') }
            : {}),
        }
      : false,
    max: 10,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    application_name: 'sikkim-api',
    options: '-c timezone=UTC',
  };
}

export interface Database {
  transaction<T>(operation: (client: pg.PoolClient) => Promise<T>): Promise<T>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(
  config: Config,
  onIdleError: () => void,
): Database {
  const pool = new pg.Pool(poolOptions(config));
  pool.on('error', onIdleError);
  return {
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async ready() {
      const result = await pool.query<{ safe: boolean }>(
        `
          SELECT NOT r.rolsuper
            AND NOT r.rolcreatedb
            AND NOT r.rolcreaterole
            AND NOT r.rolbypassrls
            AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
            AND has_table_privilege(
              current_user,
              'public.audit_logs',
              'SELECT, INSERT'
            )
            AND NOT has_table_privilege(
              current_user,
              'public.audit_logs',
              'UPDATE, DELETE, TRUNCATE'
            )
            AND EXISTS (
              SELECT 1
              FROM public.schema_migrations
              WHERE name = $1
            ) AS safe
          FROM pg_roles r
          WHERE r.rolname = current_user
        `,
        [latestMigration],
      );
      if (!result.rows[0]?.safe) {
        throw new Error('Database is not ready for the application role');
      }
    },
    close: () => pool.end(),
  };
}
