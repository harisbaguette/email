import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

const mode = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null;
if (!mode) throw new Error('Use --local or --remote.');
await mkdir('.local', { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString('base64url');
const hash = await bcrypt.hash(password, 12);
const sqlFile = resolve(`.local/password-${mode.slice(2)}.sql`);
await writeFile(sqlFile, `INSERT INTO settings (key, value) VALUES ('password_hash', '${hash}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;\nDELETE FROM sessions;\nDELETE FROM login_attempts;\n`, { mode: 0o600 });
try {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', mode, '--file', sqlFile], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout).replaceAll(hash, '[REDACTED]'));
    process.exitCode = 1;
  } else {
    const location = mode === '--remote' ? 'https://email.bluekite.co.kr' : 'http://127.0.0.1:8787';
    const filename = mode === '--remote' ? '.local/접속정보.txt' : '.local/local-access.json';
    await writeFile(filename, mode === '--remote'
      ? `Bluekite Mail\n\n주소: ${location}\n비밀번호: ${password}\n\n로그인 후 설정에서 비밀번호를 바꿀 수 있습니다.\n`
      : JSON.stringify({ url: location, password }), { mode: 0o600 });
    await chmod(filename, 0o600);
    console.log(`비밀번호 설정 완료. 접속 정보: ${filename}`);
  }
} finally { await rm(sqlFile, { force: true }); }
