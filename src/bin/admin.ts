// Operator command for admin access, run on the server with the migration
// (owner) credentials. The person must first register in the app.
//   npm run admin -- grant --email=person@example.com
//   npm run admin -- revoke --email=person@example.com
//   npm run admin -- list
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ConfigurationError, databaseUrl, loadConfig } from '../config.js';
import { poolOptions } from '../db/database.js';

class UsageError extends Error {}

async function main() {
  const config = loadConfig();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new UsageError('MIGRATION_DATABASE_URL is required.');
  const owner = databaseUrl(url);
  const app = databaseUrl(config.connectionString);
  if (owner.host !== app.host || owner.pathname !== app.pathname) {
    throw new UsageError('DATABASE_URL and MIGRATION_DATABASE_URL must match.');
  }
  const [command, option, ...extra] = process.argv.slice(2);
  const email = option?.startsWith('--email=')
    ? option.slice('--email='.length).trim().toLowerCase()
    : undefined;
  if (
    extra.length ||
    !(
      (command === 'list' && !option) ||
      (['grant', 'revoke'].includes(command ?? '') && email)
    )
  ) {
    throw new UsageError(
      'Use: grant --email=<email> | revoke --email=<email> | list',
    );
  }
  const client = new pg.Client(poolOptions(config, url));
  await client.connect();
  try {
    if (command === 'list') {
      const rows = (
        await client.query(`
          SELECT u.display_name, i.subject AS email, r.assigned_at
          FROM public.user_roles r
            JOIN public.users u ON u.id = r.user_id
            LEFT JOIN public.auth_identities i
              ON i.user_id = u.id AND i.provider = 'password'
          WHERE r.role = 'admin'
          ORDER BY r.assigned_at
        `)
      ).rows;
      if (!rows.length) console.log('No admins yet.');
      for (const row of rows)
        console.log(`${row.email ?? '(no email)'}\t${row.display_name}`);
      return;
    }
    await client.query('BEGIN');
    const user = (
      await client.query(
        `
          SELECT u.id, u.status, u.is_demo
          FROM public.auth_identities i
            JOIN public.users u ON u.id = i.user_id
          WHERE i.provider = 'password' AND i.subject = $1
          FOR UPDATE OF u
        `,
        [email],
      )
    ).rows[0];
    if (!user)
      throw new UsageError(
        'No account uses that email. Register in the app first.',
      );
    if (command === 'grant') {
      if (user.status !== 'active' || user.is_demo)
        throw new UsageError('Only active, real accounts can be admins.');
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
        [user.id],
      );
    } else {
      await client.query(
        `DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
        [user.id],
      );
    }
    await client.query(
      `
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, request_id)
        VALUES (NULL, $1, 'user', $2, $3)
      `,
      [
        `admin.role_${command === 'grant' ? 'granted' : 'revoked'}.cli`,
        user.id,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
    console.log(
      `Admin role ${command === 'grant' ? 'granted to' : 'removed from'} ${email}.`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  // Avoid printing raw database errors, which can include connection details.
  console.error(
    error instanceof UsageError || error instanceof ConfigurationError
      ? error.message
      : 'Admin command failed. Check the environment and database access.',
  );
  process.exitCode = 1;
}
