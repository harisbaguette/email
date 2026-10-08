import type { MessageAction } from '../shared/types';
import { HttpError, type Env } from './types';
import { normalizeAddress } from './mail';

export const addressQuery = `SELECT a.address, a.managed, a.label, a.hidden, a.blocked,
  COUNT(m.id) AS count, COALESCE(SUM(m.is_read = 0 AND m.category = 'inbox'), 0) AS unread
  FROM addresses a LEFT JOIN messages m ON m.recipient = a.address AND m.deleted_at IS NULL
  GROUP BY a.address ORDER BY a.created_at DESC, a.address`;

export function actionUpdate(action: unknown): { sql: string; values: (number | string | null)[] } {
  switch (action as MessageAction) {
    case 'read': case 'unread': return { sql: 'is_read=?', values: [Number(action === 'read')] };
    case 'star': case 'unstar': return { sql: 'is_starred=?', values: [Number(action === 'star')] };
    case 'archive': case 'unarchive': return { sql: 'archived_at=?', values: [action === 'archive' ? Date.now() : null] };
    case 'trash': case 'restore': return { sql: 'deleted_at=?', values: [action === 'trash' ? Date.now() : null] };
    case 'inbox': case 'promotions': return { sql: "category=?,category_source='manual',sorted_at=?,sort_token=NULL,archived_at=NULL", values: [action as string, Date.now()] };
    default: throw new HttpError(400, '지원하지 않는 작업입니다.');
  }
}
export async function bulkMessages(env: Env, body: Record<string, unknown>) {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) {
    throw new HttpError(400, '메일은 한 번에 100통까지 선택할 수 있습니다.');
  }
  const ids = JSON.stringify([...new Set(body.ids)]);
  if (body.action === 'delete') {
    const result = await env.DB.prepare('DELETE FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NOT NULL').bind(ids).run();
    return { changed: result.meta.changes };
  }
  const update = actionUpdate(body.action);
  const result = await env.DB.prepare(`UPDATE messages SET ${update.sql} WHERE id IN (SELECT value FROM json_each(?))`).bind(...update.values, ids).run();
  return { changed: result.meta.changes };
}
export async function updateAddress(env: Env, body: Record<string, unknown>) {
  const address = typeof body.address === 'string' ? normalizeAddress(body.address, env.MAIL_DOMAIN) : null;
  if (!address) throw new HttpError(400, '이메일 주소를 확인해 주세요.');
  const parts: string[] = []; const values: (string | number)[] = [];
  if ('label' in body) {
    if (typeof body.label !== 'string' || body.label.length > 60 || /[\x00-\x1f]/.test(body.label)) throw new HttpError(400, '주소 메모는 60자 이내로 입력해 주세요.');
    parts.push('label=?'); values.push(body.label.trim());
  }
  for (const key of ['managed', 'hidden', 'blocked']) if (key in body) {
    if (typeof body[key] !== 'boolean') throw new HttpError(400, '주소 설정을 확인해 주세요.');
    parts.push(`${key}=?`); values.push(Number(body[key]));
  }
  if (!parts.length) throw new HttpError(400, '바꿀 설정을 선택해 주세요.');
  const result = await env.DB.prepare(`UPDATE addresses SET ${parts.join(',')} WHERE address=?`).bind(...values, address).run();
  if (!result.meta.changes) throw new HttpError(404, '주소를 찾을 수 없습니다.');
}
export function ruleSender(value: unknown) {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) throw new HttpError(400, '보낸 사람의 이메일 주소를 입력해 주세요.');
  return value.toLowerCase();
}
