import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function cleanupFixtures(locals: string[]) {
  if (!locals.length) return;
  if (locals.some(local => !/^[a-z0-9-]+$/.test(local))) throw new Error('Invalid test address');
  const addresses = locals.map(local => `'${local}@bluekite.co.kr'`).join(',');
  // The email simulator and these fixtures exist only in Wrangler's local D1.
  await promisify(execFile)(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', '--local', '--command',
    `DELETE FROM messages WHERE recipient IN (${addresses}); DELETE FROM addresses WHERE address IN (${addresses});`]);
}
