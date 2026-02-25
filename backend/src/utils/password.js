import crypto from 'crypto';

const HASH_ALGORITHM = 'sha512';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const DEFAULT_ITERATIONS = 120000;

export function hashPassword(plainPassword, iterations = DEFAULT_ITERATIONS) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password is required');
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.pbkdf2Sync(plainPassword, salt, iterations, KEY_LENGTH, HASH_ALGORITHM).toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(plainPassword, encodedHash) {
  if (!plainPassword || !encodedHash || typeof encodedHash !== 'string') {
    return false;
  }

  const [scheme, iterationsRaw, salt, storedHash] = encodedHash.split('$');
  if (scheme !== 'pbkdf2' || !iterationsRaw || !salt || !storedHash) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const computed = crypto
    .pbkdf2Sync(plainPassword, salt, iterations, KEY_LENGTH, HASH_ALGORITHM)
    .toString('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
