import type { InboxResult, MessageSummary } from '../shared/types';
import { HttpError, type Env } from './types';
import { normalizeAddress } from './mail';

export async function getInbox(url: URL, env: Env): Promise<InboxResult> {
  const folder = url.searchParams.get('folder') || 'inbox';
  if (!['inbox', 'unread', 'trash'].includes(folder)) throw new HttpError(400, '수신함을 찾을 수 없습니다.');
  const recipient = url.searchParams.get('address') || '';
  if (recipient && !normalizeAddress(recipient, env.MAIL_DOMAIN)) throw new HttpError(400, '이메일 주소를 확인해 주세요.');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const clauses = [folder === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (folder === 'unread') clauses.push('is_read = 0');
  if (recipient) { clauses.push('recipient = ?'); params.push(recipient); }
  if (q) {
    clauses.push("(subject LIKE ? ESCAPE '\\' OR sender_address LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR recipient LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')");
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    let time: number; let id: string;
    try {
      const value = JSON.parse(atob(cursor));
      time = value[0]; id = value[1];
      if (!Number.isSafeInteger(time) || typeof id !== 'string' || !/^[\da-f-]{36}$/.test(id)) throw new Error();
    } catch { throw new HttpError(400, '목록을 새로고침해 주세요.'); }
    clauses.push('(received_at < ? OR (received_at = ? AND id < ?))');
    params.push(time, time, id);
  }
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT id, recipient, sender_address, sender_name, subject, preview,
      attachments, received_at, is_read, deleted_at FROM messages
      WHERE ${clauses.join(' AND ')} ORDER BY received_at DESC, id DESC LIMIT 51`).bind(...params),
    env.DB.prepare(`SELECT
      COALESCE(SUM(deleted_at IS NULL), 0) AS inbox,
      COALESCE(SUM(deleted_at IS NULL AND is_read = 0), 0) AS unread,
      COALESCE(SUM(deleted_at IS NOT NULL), 0) AS trash FROM messages`),
    env.DB.prepare(`SELECT a.address,
      COUNT(m.id) AS count, COALESCE(SUM(m.is_read = 0), 0) AS unread
      FROM addresses a LEFT JOIN messages m ON m.recipient = a.address AND m.deleted_at IS NULL
      GROUP BY a.address ORDER BY a.created_at DESC, a.address`),
  ]);
  const rows = results[0].results as Record<string, unknown>[];
  const more = rows.length > 50;
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    messages: page.map(row => ({ ...row, attachments: JSON.parse(row.attachments as string) })) as MessageSummary[],
    counts: results[1].results[0] as InboxResult['counts'],
    addresses: results[2].results as unknown as InboxResult['addresses'],
    nextCursor: more && last ? btoa(JSON.stringify([last.received_at, last.id])) : null,
  };
}
