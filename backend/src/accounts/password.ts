import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AccountError } from './model.js';

// OWASP's 32 MiB scrypt profile. Bound concurrent work to avoid memory exhaustion.
const prefix = 'scrypt$32768$8$3';
let active = 0;
const dummySalt = randomBytes(16).toString('hex');
const dummyHash = `${prefix}$${dummySalt}$${randomBytes(32).toString('hex')}`;

async function derive(password: string, salt: string): Promise<Buffer> {
  if (active >= 4) {
    throw new AccountError(
      503,
      'AUTH_BUSY',
      'Sign-in is busy. Please try again shortly.',
    );
  }
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        Buffer.from(salt, 'hex'),
        32,
        { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    active--;
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `${prefix}$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored?: string) {
  const encoded = stored ?? dummyHash;
  if (!/^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded)) {
    throw new Error('Unsupported password hash');
  }
  const parts = encoded.split('$');
  const actual = await derive(password, parts[4]!);
  const matches = timingSafeEqual(actual, Buffer.from(parts[5]!, 'hex'));
  return stored !== undefined && matches;
}
