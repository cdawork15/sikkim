import { spawnSync } from 'node:child_process';

const result = spawnSync('sh', ['db/setup-local.sh'], { stdio: 'inherit' });
if (result.error) {
  console.error(
    'Could not start local database setup. Check sh and psql are available.',
  );
}
process.exitCode = result.status ?? 1;
