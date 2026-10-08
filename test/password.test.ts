import { afterEach, describe, it, expect, vi } from 'vitest';
import { hashPassword, passwordMatches } from '../shared/password';
import { isBreachedPassword, validateNewPassword } from '../shared/password-policy';
import bcrypt from 'bcryptjs';

afterEach(() => vi.unstubAllGlobals());

describe('password hashing in the Workers runtime', () => {
  it('handles long Unicode, spaces and normalization without truncation', async () => {
    const password = '가🙂 '.repeat(21) + '끝';
    const hash = await hashPassword(password);
    expect(await passwordMatches(password, hash)).toBe(true);
    expect(await passwordMatches(password + 'x', hash)).toBe(false);
    expect(await passwordMatches(password.normalize('NFD'), hash)).toBe(true);
    expect(await hashPassword(password)).not.toBe(hash);
  });
  it('keeps legacy credentials without accepting a longer matching bcrypt prefix', async () => {
    const hash = await bcrypt.hash('a'.repeat(72), 4);
    expect(await passwordMatches('a'.repeat(72), hash)).toBe(true);
    expect(await passwordMatches('a'.repeat(72) + 'x', hash)).toBe(false);
  });
  it('checks 15–128 Unicode code points with no composition requirements', () => {
    for (const length of [0, 7, 8, 14, 129]) expect(() => validateNewPassword('가'.repeat(length))).toThrow();
    for (const value of ['a'.repeat(15), '🙂'.repeat(64), '가'.repeat(128), ' spaces inside and outside ', '한글 문장으로 만드는 긴 비밀번호']) expect(() => validateNewPassword(value)).not.toThrow();
  });
  it('sends only a padded hash prefix and blocks positive breach matches', async () => {
    // SHA-1('password') is a public test vector, never a real credential.
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response('not-a-range-response'));
    vi.stubGlobal('fetch', fetcher);
    // Correct suffix is 35 characters; invalid upstream data must fail closed.
    await expect(isBreachedPassword('password')).rejects.toThrow();
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode('password'));
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    fetcher.mockImplementation(async () => new Response(hash.slice(5) + ':10'));
    expect(await isBreachedPassword('password')).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('"password"');
    fetcher.mockImplementation(async () => new Response(hash.slice(5) + ':0'));
    expect(await isBreachedPassword('password')).toBe(false);
  });
  it('does not treat network failure, an empty response or oversized data as safe', async () => {
    for (const response of [new Response('', { status: 503 }), new Response(''), new Response('x'.repeat(262145))]) {
      vi.stubGlobal('fetch', vi.fn(async () => response));
      await expect(isBreachedPassword('never-a-real-password')).rejects.toThrow();
    }
  });
});
