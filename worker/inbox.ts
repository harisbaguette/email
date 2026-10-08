import type { InboxResult, MessageSummary } from '../shared/types';
import { HttpError, type Env } from './types';
import { normalizeAddress } from './mail';
import { sortingStatus } from './sorting';
import { indexLegacyMessages } from './message-index';
import { SEARCH_LIMIT, searchTokens, validSearchDate } from '../shared/search';
import { addressQuery } from './management';

export async function getInbox(url: URL, env: Env): Promise<InboxResult> {
  await indexLegacyMessages(env);
  const folder = url.searchParams.get('folder') || 'inbox';
  if (!['inbox', 'verification', 'unread', 'starred', 'archive', 'promotions', 'all', 'trash'].includes(folder)) throw new HttpError(400, '수신함을 찾을 수 없습니다.');
  const recipient = url.searchParams.get('address') || '';
  if (recipient && !normalizeAddress(recipient, env.MAIL_DOMAIN)) throw new HttpError(400, '이메일 주소를 확인해 주세요.');
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length > SEARCH_LIMIT) throw new HttpError(400, `검색 조건은 ${SEARCH_LIMIT}자까지 입력할 수 있습니다.`);
  const clauses = [folder === 'trash' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (folder === 'inbox' || folder === 'unread') clauses.push("category = 'inbox' AND archived_at IS NULL");
  if (folder === 'verification') clauses.push('is_verification = 1');
  if (folder === 'starred') clauses.push('is_starred = 1');
  if (folder === 'archive') clauses.push('archived_at IS NOT NULL');
  if (folder === 'promotions') clauses.push("category = 'promotions'");
  if (folder === 'unread') clauses.push('is_read = 0');
  if (recipient) { clauses.push('recipient = ?'); params.push(recipient); }
  const tokens = searchTokens(q);
  const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
  for (const token of tokens) {
    const parsed = token.match(/^(from|to|subject|after|before|has|is):(.+)$/i);
    const value = (parsed?.[2] || token).replace(/^"|"$/g, '');
    const key = parsed?.[1].toLowerCase();
    if (key === 'from' || key === 'to' || key === 'subject') {
      const column = key === 'from' ? 'sender_address' : key === 'to' ? 'recipient' : 'subject';
      if (key === 'from') { clauses.push("(sender_address LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\')"); params.push(like(value), like(value)); }
      else { clauses.push(`${column} LIKE ? ESCAPE '\\'`); params.push(like(value)); }
    } else if (key === 'after' || key === 'before') {
      const stamp = Date.parse(value + 'T00:00:00+09:00');
      if (!validSearchDate(value)) throw new HttpError(400, '검색 날짜는 올바른 YYYY-MM-DD로 입력해 주세요.');
      clauses.push(`received_at ${key === 'after' ? '>=' : '<'} ?`); params.push(stamp);
    } else if (key === 'has' && value === 'attachment') clauses.push("attachments != '[]'");
    else if (key === 'is' && ['unread', 'read', 'starred', 'verification'].includes(value)) clauses.push(value === 'unread' ? 'is_read=0' : value === 'read' ? 'is_read=1' : value === 'starred' ? 'is_starred=1' : 'is_verification=1');
    else {
      clauses.push("(subject LIKE ? ESCAPE '\\' OR sender_address LIKE ? ESCAPE '\\' OR sender_name LIKE ? ESCAPE '\\' OR recipient LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')");
      params.push(...Array(5).fill(like(value)));
    }
  }
  if (params.length > 85) throw new HttpError(400, '검색어를 조금 줄여 주세요.');
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
      attachments, received_at, is_read, is_starred, archived_at, is_verification, verification_code, deleted_at, category, category_source FROM messages
      WHERE ${clauses.join(' AND ')} ORDER BY received_at DESC, id DESC LIMIT 51`).bind(...params),
    env.DB.prepare(`SELECT
      COALESCE(SUM(deleted_at IS NULL AND category = 'inbox' AND archived_at IS NULL), 0) AS inbox,
      COALESCE(SUM(deleted_at IS NULL AND category = 'inbox' AND archived_at IS NULL AND is_read = 0), 0) AS unread,
      COALESCE(SUM(deleted_at IS NULL AND category = 'promotions'), 0) AS promotions,
      COALESCE(SUM(deleted_at IS NULL), 0) AS 'all',
      COALESCE(SUM(deleted_at IS NULL AND is_verification=1), 0) AS verification,
      COALESCE(SUM(deleted_at IS NULL AND is_starred=1), 0) AS starred,
      COALESCE(SUM(deleted_at IS NULL AND archived_at IS NOT NULL), 0) AS archive,
      COALESCE(SUM(deleted_at IS NOT NULL), 0) AS trash FROM messages`),
    env.DB.prepare(addressQuery),
  ]);
  const rows = results[0].results as Record<string, unknown>[];
  const more = rows.length > 50;
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    messages: page.map(row => ({ ...row, attachments: JSON.parse(row.attachments as string) })) as MessageSummary[],
    counts: results[1].results[0] as InboxResult['counts'],
    addresses: results[2].results as unknown as InboxResult['addresses'],
    sorting: await sortingStatus(env),
    nextCursor: more && last ? btoa(JSON.stringify([last.received_at, last.id])) : null,
  };
}
