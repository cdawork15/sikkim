import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const [name, environment, message] of [
  ['production', { NODE_ENV: 'production' }, 'requires NODE_ENV'],
  ['missing environment', {}, 'requires NODE_ENV'],
  [
    'remote server',
    { NODE_ENV: 'development', PGHOST: 'remote.example' },
    'only accepts a localhost',
  ],
  [
    'missing passwords',
    { NODE_ENV: 'development', PGHOST: '127.0.0.1' },
    'Set DB_OWNER_PASSWORD',
  ],
] as const) {
  test(`local database setup refuses ${name} before database access`, () => {
    const result = spawnSync('sh', ['db/setup-local.sh'], {
      env: { PATH: process.env.PATH ?? '', ...environment },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message));
    assert.equal(result.stdout, '');
  });
}
