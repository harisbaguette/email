import { passwordLength } from './password.ts';

export function validateNewPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || passwordLength(password) < 15 || passwordLength(password) > 128) {
    throw new Error('새 비밀번호는 15~128자로 입력해 주세요. 공백과 한글도 쓸 수 있습니다.');
  }
}

export function isContextPassword(password: string, username: string) {
  let rest = password.normalize('NFC').toLowerCase();
  const words = ['bluekite', 'mailroom', username.toLowerCase()].filter(Boolean);
  const found = words.some(word => rest.includes(word));
  for (const word of words) rest = rest.replaceAll(word, '');
  return found && !rest.replace(/[\p{P}\p{S}\p{Z}\s\d]/gu, '');
}

// Only the first five SHA-1 hex characters leave the server. No password, full hash,
// account identifier or client IP is sent. Login never depends on this service.
export async function isBreachedPassword(password: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password.normalize('NFC')));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'Mailroom-Password-Check' },
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body) throw new Error('Password check unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); let size = 0; let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new Error('Invalid password check response'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length || lines.some(line => !/^[A-F0-9]{35}:\d+$/.test(line))) throw new Error('Invalid password check response');
  return lines.some(line => line.startsWith(`${hash.slice(5)}:`) && Number(line.split(':')[1]) > 0);
}
