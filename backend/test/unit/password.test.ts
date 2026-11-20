import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '../../src/accounts/password.js';

test('passwords use random salts and preserve unicode and whitespace', async () => {
  const password = '  हिमालय mountain trail  ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword('unknown password', undefined), false);
  assert.equal(normalizeEmail('  Pema@Example.COM '), 'pema@example.com');
  await assert.rejects(verifyPassword(password, 'corrupt'), /Unsupported/);
});
