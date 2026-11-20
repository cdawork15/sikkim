// Operator command for staff access, run on the server with the migration
// (owner) credentials. The person must first sign in to the app once.
//   npm run admin -- grant --email=person@example.com [--role=admin|super]
//   npm run admin -- grant --phone=+919800000000 --role=super
//   npm run admin -- revoke --email=person@example.com [--role=admin|super]
//   npm run admin -- list
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ConfigurationError, databaseUrl, loadConfig } from '../config.js';
import { poolOptions } from '../db/database.js';

class UsageError extends Error {}
const usage =
  'Use: grant|revoke --email=<email>|--phone=<+countrycode…> [--role=admin|super] | list';

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const options = new Map<string, string>();
  for (const arg of rest) {
    const match = /^--(email|phone|role)=(.+)$/.exec(arg);
    if (!match || options.has(match[1]!)) throw new UsageError(usage);
    options.set(match[1]!, match[2]!.trim());
  }
  const role = options.get('role') ?? 'admin';
  if (!['admin', 'super'].includes(role)) throw new UsageError(usage);
  const email = options.get('email')?.toLowerCase();
  const phone = options.get('phone')?.replace(/[\s()-]/g, '');
  if (command === 'list') {
    if (options.size) throw new UsageError(usage);
    return { command, role, email, phone };
  }
  if (!['grant', 'revoke'].includes(command ?? '') || !email === !phone)
    throw new UsageError(usage);
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
    throw new UsageError(
      'Give the phone with its country code, like +919800000000.',
    );
  return { command, role, email, phone };
}

async function main() {
  const config = loadConfig();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new UsageError('MIGRATION_DATABASE_URL is required.');
  const owner = databaseUrl(url);
  const app = databaseUrl(config.connectionString);
  if (owner.host !== app.host || owner.pathname !== app.pathname) {
    throw new UsageError('DATABASE_URL and MIGRATION_DATABASE_URL must match.');
  }
  const { command, role, email, phone } = parseArgs(process.argv.slice(2));
  const client = new pg.Client(poolOptions(config, url));
  await client.connect();
  try {
    if (command === 'list') {
      const rows = (
        await client.query(`
          SELECT r.role, u.display_name,
            (SELECT string_agg(subject, ', ' ORDER BY provider)
               FROM public.auth_identities WHERE user_id = u.id) AS sign_in
          FROM public.user_roles r
            JOIN public.users u ON u.id = r.user_id
          WHERE r.role IN ('admin', 'super')
          ORDER BY r.role DESC, r.assigned_at
        `)
      ).rows;
      if (!rows.length) console.log('No staff yet.');
      for (const row of rows)
        console.log(
          `${row.role}\t${row.sign_in ?? '(no sign-in)'}\t${row.display_name}`,
        );
      return;
    }
    await client.query('BEGIN');
    const user = (
      await client.query(
        `
          SELECT u.id, u.status, u.is_demo
          FROM public.auth_identities i
            JOIN public.users u ON u.id = i.user_id
          WHERE i.provider = ANY($1) AND i.subject = $2
          ORDER BY i.created_at
          LIMIT 1
          FOR UPDATE OF u
        `,
        [email ? ['email', 'password'] : ['phone'], email ?? phone],
      )
    ).rows[0];
    if (!user)
      throw new UsageError(
        'No account uses that sign-in. Ask the person to sign in to the app once first.',
      );
    if (command === 'grant') {
      if (user.status !== 'active' || user.is_demo)
        throw new UsageError('Only active, real accounts can be staff.');
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, role],
      );
    } else {
      await client.query(
        'DELETE FROM public.user_roles WHERE user_id = $1 AND role = $2',
        [user.id, role],
      );
    }
    await client.query(
      `
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, request_id)
        VALUES (NULL, $1, 'user', $2, $3)
      `,
      [
        `admin.role_${command === 'grant' ? 'granted' : 'revoked'}.${role}.cli`,
        user.id,
        randomUUID(),
      ],
    );
    await client.query('COMMIT');
    console.log(
      `${role} role ${command === 'grant' ? 'granted to' : 'removed from'} ${email ?? phone}.`,
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
