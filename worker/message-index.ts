import { verificationCode, hasVerificationLabel } from '../shared/verification';
import { verificationLink } from './verification';
import type { Env } from './types';
export function verificationFields(subject: string, text: string, html: string) {
  const code = verificationCode(subject, text);
  return { code, verified: Number(Boolean(code || hasVerificationLabel(subject, text) || verificationLink(subject, text, html))) };
}
export async function indexLegacyMessages(env: Env) {
  const { results } = await env.DB.prepare('SELECT id,subject,body_text,body_html FROM messages WHERE verification_version=0 LIMIT 40')
    .all<{ id: string; subject: string; body_text: string; body_html: string }>();
  if (!results.length) return;
  await env.DB.batch(results.map(row => {
    const fields = verificationFields(row.subject, row.body_text, row.body_html);
    return env.DB.prepare('UPDATE messages SET verification_code=?,is_verification=?,verification_version=1 WHERE id=? AND verification_version=0').bind(fields.code, fields.verified, row.id);
  }));
}
