import { seedPreview } from '../db/preview.js';
import { loadConfig } from '../config.js';
import { migrate, seedOrReset } from '../db/maintenance.js';

try {
  const config = loadConfig();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error('MIGRATION_DATABASE_URL is required');
  }
  const [command, confirmation] = process.argv.slice(2);
  if (command === 'migrate' && !confirmation) {
    await migrate(config, url);
  } else if (command === 'preview' && !confirmation) {
    await seedPreview(config, url);
  } else if (command === 'seed' && !confirmation) {
    await seedOrReset(config, url);
  } else if (command === 'reset' && confirmation?.startsWith('--confirm=')) {
    await seedOrReset(config, url, confirmation.slice('--confirm='.length));
  } else {
    throw new Error(
      'Use migrate, seed, preview, or reset --confirm=<local database name>',
    );
  }
  console.log('Database command completed.');
} catch {
  // Database errors may include credentials or private query values.
  console.error(
    'Database command failed. Check environment, permissions, ' +
      'migration state and local reset safeguards.',
  );
  process.exitCode = 1;
}
