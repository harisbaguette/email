import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';

// Local-only keys. Existing developer configuration is preserved.
let vars = await readFile('.dev.vars', 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const has = (name) => new RegExp(`^\\s*${name}\\s*=`, 'm').test(vars);
const additions = [];
if (!has('MFA_ENCRYPTION_KEY'))
  additions.push(`MFA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
if (has('VAPID_PUBLIC_KEY') !== has('VAPID_PRIVATE_KEY'))
  throw new Error('.dev.vars의 VAPID_PUBLIC_KEY와 VAPID_PRIVATE_KEY를 한 쌍으로 설정해 주세요.');
if (!has('VAPID_PUBLIC_KEY')) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(key.x, 'base64url'),
    Buffer.from(key.y, 'base64url'),
  ]);
  additions.push(
    `VAPID_PUBLIC_KEY=${publicKey.toString('base64url')}`,
    `VAPID_PRIVATE_KEY=${key.d}`,
  );
}
if (additions.length) {
  vars += `\n# 로컬 시험용 키\n${additions.join('\n')}\n`;
  await writeFile('.dev.vars', vars, { mode: 0o600 });
  await chmod('.dev.vars', 0o600);
}
console.log('로컬 시험 환경 준비 완료');
