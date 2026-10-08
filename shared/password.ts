import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

// OWASP's 16 MiB scrypt profile; native crypto also runs in Workers nodejs_compat.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const prefix = '$scrypt$ln=14,r=8,p=5$';
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFC'), salt, 32, options,
    (error, result) => error ? reject(error) : resolve(result)));
}
export function passwordLength(password: string) { return [...password.normalize('NFC')].length; }
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${prefix}${Buffer.from(salt).toString('hex')}$${Buffer.from(await derive(password, salt)).toString('hex')}`;
}
export async function passwordMatches(password: string, hash: string) {
  if (passwordLength(password) > 128) return false;
  if (hash.startsWith('$2')) {
    // Keep existing credentials valid, but never accept a truncated bcrypt prefix.
    return new TextEncoder().encode(password).length <= 72 && bcrypt.compare(password, hash);
  }
  if (!hash.startsWith(prefix)) return false;
  const [salt, digest, extra] = hash.slice(prefix.length).split('$');
  if (extra !== undefined || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(await derive(password, Buffer.from(salt, 'hex')), Buffer.from(digest, 'hex'));
}
