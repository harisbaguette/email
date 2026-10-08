import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashPassword } from '../shared/password.ts';
import { validateNewPassword, isBreachedPassword, isContextPassword } from '../shared/password-policy.ts';

const mode = process.argv.includes('--remote') ? '--remote' : process.argv.includes('--local') ? '--local' : null;
if (!mode) throw new Error('Use --local or --remote.');
await mkdir('.local', { recursive: true, mode: 0o700 });
const inputIndex = process.argv.indexOf('--credentials-file');
const requested = inputIndex < 0 ? null : JSON.parse(await readFile(process.argv[inputIndex + 1], 'utf8'));
if (requested && (typeof requested.username !== 'string' || !/^[a-zA-Z0-9_.@-]{3,64}$/.test(requested.username)
  || typeof requested.password !== 'string')) throw new Error('Invalid credentials file.');
const password = requested?.password || randomBytes(24).toString('base64url');
validateNewPassword(password);
if (requested && isContextPassword(password, requested.username)) throw new Error('서비스 이름이나 아이디로 만든 비밀번호는 쓸 수 없습니다.');
if (requested && await isBreachedPassword(password)) throw new Error('이미 유출된 비밀번호입니다. 다른 비밀번호를 선택해 주세요.');
const hash = await hashPassword(password);
const sqlFile = resolve(`.local/password-${mode.slice(2)}.sql`);
const usernameSQL = requested
  ? `INSERT INTO settings (key, value) VALUES ('login_username', '${requested.username}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`
  : "INSERT OR IGNORE INTO settings (key, value) VALUES ('login_username', 'owner');";
const resetFactorSQL = process.argv.includes('--disable-two-factor') ? "DELETE FROM two_factor; DELETE FROM recovery_codes; DELETE FROM two_factor_setups;" : '';
await writeFile(sqlFile, `INSERT INTO settings (key, value) VALUES ('password_hash', '${hash}') ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n${usernameSQL}\nINSERT INTO settings (key,value) VALUES ('auth_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT);\nDELETE FROM sessions;\nDELETE FROM push_subscriptions;\nDELETE FROM login_attempts;\n${resetFactorSQL}\n`, { mode: 0o600 });
try {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', mode, '--file', sqlFile], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write((result.stderr || result.stdout).replaceAll(hash, '[REDACTED]'));
    process.exitCode = 1;
  } else {
    const account = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'bluekite-mail', mode, '--command', "SELECT value FROM settings WHERE key = 'login_username'", '--json'], { encoding: 'utf8' });
    if (account.status !== 0) throw new Error('Account was updated, but reading the login name failed.');
    const username = JSON.parse(account.stdout)[0].results[0].value;
    const location = mode === '--remote' ? 'https://email.bluekite.co.kr' : 'http://127.0.0.1:8787';
    const filename = mode === '--remote' ? '.local/접속정보.txt' : '.local/local-access.json';
    await writeFile(filename, mode === '--remote'
      ? `Mailroom\n\n주소: ${location}\n아이디: ${username}\n비밀번호: ${password}\n\n로그인 후 설정에서 비밀번호를 바꿀 수 있습니다.\n`
      : JSON.stringify({ url: location, username, password }), { mode: 0o600 });
    await chmod(filename, 0o600);
    console.log(`비밀번호 설정 완료. 접속 정보: ${filename}`);
  }
} finally { await rm(sqlFile, { force: true }); }
