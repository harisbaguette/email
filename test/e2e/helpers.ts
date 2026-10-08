import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

export async function registerFixtureAddress(request: APIRequestContext, local: string) {
  const response = await request.post('/api/addresses', { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' }, data: { local } });
  if (!response.ok()) throw new Error(`Cannot register test address: ${response.status()}`);
}

export async function seedPagination(local: string, count: number) {
  if (!/^[a-z0-9-]+$/.test(local) || count > 100) throw new Error('Invalid fixture');
  // Pagination needs a historical mailbox, not a live SMTP flood that bypasses abuse protection.
  const statements = Array.from({ length: count }, (_, n) => {
    const id = randomUUID();
    return `INSERT INTO messages (id,recipient,sender_address,sender_name,subject,preview,body_text,received_at,raw_size,stored_size,fingerprint,verification_code,is_verification,verification_version,category_source)
      SELECT '${id}',recipient,sender_address,sender_name,'Mail ${n+1}',preview,body_text,received_at-${n+1},raw_size,2048,'fixture-${id}',verification_code,is_verification,verification_version,category_source
      FROM messages WHERE recipient='${local}@bluekite.co.kr' ORDER BY received_at DESC LIMIT 1;`;
  }).join('\n');
  await promisify(execFile)(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', '--local', '--command', statements]);
}

export async function cleanupFixtures(locals: string[]) {
  if (!locals.length) return;
  if (locals.some(local => !/^[a-z0-9-]+$/.test(local))) throw new Error('Invalid test address');
  const addresses = locals.map(local => `'${local}@bluekite.co.kr'`).join(',');
  // The email simulator and these fixtures exist only in Wrangler's local D1.
  await promisify(execFile)(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', '--local', '--command',
    `DELETE FROM messages WHERE recipient IN (${addresses}); DELETE FROM addresses WHERE address IN (${addresses});`]);
}
