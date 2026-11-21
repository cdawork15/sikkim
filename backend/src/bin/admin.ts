// Operator command for staff access, run on the server with the migration
// (owner) credentials. The person must first sign in to the app once.
//   npm run admin -- grant --email=person@example.com [--role=admin|super]
//   npm run admin -- grant --phone=+919800000000 --role=super
//   npm run admin -- revoke --email=person@example.com [--role=admin|super]
//   npm run admin -- list
//   npm run admin -- set-password --email=person@example.com
//     (asks for the password; or pipe it in: printf '%s' "$PASSWORD" | npm run admin -- set-password …)
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import pg from 'pg';
import { hashPassword } from '../accounts/password.js';
import { ConfigurationError, databaseUrl, loadConfig } from '../config.js';
import { poolOptions } from '../db/database.js';

class UsageError extends Error {}
const usage =
  'Use: grant|revoke --email=<email>|--phone=<+countrycode…> [--role=admin|super] | set-password --email=<email> | list';

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
  if (command === 'set-password') {
    if (!email || phone || options.has('role')) throw new UsageError(usage);
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

/** Reads the new password without putting it in shell history or the process list. */
async function readPassword() {
  let value: string;
  if (process.stdin.isTTY) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const ask = (question: string) =>
      new Promise<string>((resolve) => {
        const hidden = prompt as unknown as {
          _writeToOutput: (text: string) => void;
        };
        hidden._writeToOutput = (text) => {
          if (text.includes(question)) process.stdout.write(question);
        };
        prompt.question(question, (answer) => {
          process.stdout.write('\n');
          resolve(answer);
        });
      });
    value = await ask('New password: ');
    const confirm = await ask('Repeat password: ');
    prompt.close();
    if (value !== confirm) throw new UsageError('The passwords do not match.');
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    value = Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  }
  if (value.length < 8 || value.length > 128)
    throw new UsageError('Use a password of 8 to 128 characters.');
  return value;
}

async function setPassword(client: pg.Client, email: string) {
  const password = await readPassword();
  const passwordHash = await hashPassword(password);
  await client.query('BEGIN');
  try {
    const user = (
      await client.query(
        `
          SELECT u.id, u.status, u.is_demo
          FROM public.auth_identities i
            JOIN public.users u ON u.id = i.user_id
          WHERE i.provider IN ('email', 'password') AND i.subject = $1
          ORDER BY i.created_at
          LIMIT 1
          FOR UPDATE OF u
        `,
        [email],
      )
    ).rows[0];
    if (!user)
      throw new UsageError(
        'No account uses that email. Ask the person to sign in to the app once first.',
      );
    if (user.status !== 'active' || user.is_demo)
      throw new UsageError('Only active, real accounts can have a password.');
    await client.query(
      `
        INSERT INTO public.auth_identities (user_id, provider, subject)
        VALUES ($1, 'password', $2)
        ON CONFLICT (provider, subject) DO NOTHING
      `,
      [user.id, email],
    );
    const owner = await client.query(
      `SELECT user_id FROM public.auth_identities WHERE provider = 'password' AND subject = $1`,
      [email],
    );
    if (owner.rows[0]?.user_id !== user.id)
      throw new UsageError('That email already signs in to another account.');
    await client.query(
      `
        INSERT INTO public.auth_passwords (user_id, password_hash) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `,
      [user.id, passwordHash],
    );
    // A changed password ends every existing session for that account.
    await client.query('DELETE FROM public.auth_sessions WHERE user_id = $1', [
      user.id,
    ]);
    await client.query(
      `
        INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, request_id)
        VALUES (NULL, 'account.password_set.cli', 'user', $1, $2)
      `,
      [user.id, randomUUID()],
    );
    await client.query('COMMIT');
    console.log(
      `Password set for ${email}. Existing sessions were signed out.`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
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
    if (command === 'set-password') return await setPassword(client, email!);
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
