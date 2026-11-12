import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(deriveKey);
const parameters = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 15 || password.length > 128) {
    throw new Error('Use a password between 15 and 128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, parameters);
  return `scrypt$16384$8$5$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128 || typeof stored !== 'string') return false;
  const match = /^scrypt\$16384\$8\$5\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!match) return false;
  const derived = await scrypt(password, match[1], 64, parameters);
  return timingSafeEqual(derived, Buffer.from(match[2], 'hex'));
}
