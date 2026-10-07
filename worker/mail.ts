import PostalMime from 'postal-mime';
import { convert } from 'html-to-text';
import { sha256 } from './auth';
import type { Env } from './types';
import type { AttachmentMeta } from '../shared/types';

export const MAX_EMAIL_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const encoder = new TextEncoder();

export function normalizeAddress(input: string, domain: string): string | null {
  const address = input.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1 || address.slice(at + 1) !== domain.toLowerCase()) return null;
  const local = address.slice(0, at);
  if (local.length > 64 || !/^[a-z0-9_+-](?:[a-z0-9._+-]*[a-z0-9_+-])?$/.test(local) || local.includes('..')) return null;
  return address;
}

function truncateBytes(value: string, max: number) {
  const bytes = encoder.encode(value);
  return bytes.length <= max ? value : new TextDecoder().decode(bytes.subarray(0, max));
}

export async function receiveMail(message: ForwardableEmailMessage, env: Env) {
  const recipient = normalizeAddress(message.to, env.MAIL_DOMAIN);
  if (!recipient) { message.setReject('This recipient is not supported.'); return; }
  if (message.rawSize > MAX_EMAIL_BYTES) { message.setReject('Message exceeds the 10 MiB size limit.'); return; }
  const bytes = new Uint8Array(await new Response(message.raw as unknown as ReadableStream).arrayBuffer());
  if (bytes.byteLength > MAX_EMAIL_BYTES) { message.setReject('Message exceeds the 10 MiB size limit.'); return; }
  const fingerprint = await sha256(recipient + ':' + await sha256(bytes));
  const duplicate = await env.DB.prepare('SELECT id FROM messages WHERE fingerprint = ?').bind(fingerprint).first();
  if (duplicate) return;

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(bytes);
  } catch {
    // Preserve the exact original even when a malformed message cannot be parsed.
    parsed = {
      headers: [], headerLines: [], attachments: [],
      subject: message.headers.get('Subject') || '(제목 없음)',
      text: '본문을 표시할 수 없습니다. 원본 파일을 내려받아 확인해 주세요.',
    };
  }
  const id = crypto.randomUUID();
  const received = Date.now();
  const html = parsed.html || '';
  const text = parsed.text || (html ? convert(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] }) : '');
  const storedText = truncateBytes(text, 128 * 1024);
  const storedHtml = truncateBytes(html, 900 * 1024);
  const attachments: AttachmentMeta[] = (parsed.attachments || []).map((a, index) => ({
    index, filename: (a.filename || `attachment-${index + 1}`).slice(0, 255),
    mimeType: a.mimeType, size: typeof a.content === 'string' ? a.content.length : a.content.byteLength,
  }));
  const gzip = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const compressed = new Uint8Array(gzip);
  const queries = [
    env.DB.prepare('INSERT OR IGNORE INTO addresses (address, created_at) VALUES (?, ?)').bind(recipient, received),
    env.DB.prepare(`INSERT INTO messages (
      id, recipient, sender_address, sender_name, subject, preview, body_text, body_html,
      attachments, received_at, sent_at, raw_size, stored_size, body_truncated, fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, recipient, (parsed.from?.address || message.from).slice(0, 320),
        (parsed.from?.name || '').slice(0, 256), (parsed.subject || '(제목 없음)').slice(0, 1024),
        text.replace(/\s+/g, ' ').trim().slice(0, 220) || '메일을 열어 내용을 확인하세요.',
        storedText, storedHtml, JSON.stringify(attachments), received, parsed.date || null,
        bytes.byteLength, compressed.length + encoder.encode(storedText + storedHtml).length,
        Number(storedText !== text || storedHtml !== html), fingerprint),
  ];
  for (let offset = 0, part = 0; offset < compressed.length; offset += CHUNK_BYTES, part++) {
    queries.push(env.DB.prepare('INSERT INTO raw_chunks (message_id, part, data) VALUES (?, ?, ?)')
      .bind(id, part, compressed.slice(offset, offset + CHUNK_BYTES).buffer));
  }
  try { await env.DB.batch(queries); }
  catch (error) {
    // An SMTP retry may race another delivery. Only an already committed copy is success.
    if (await env.DB.prepare('SELECT id FROM messages WHERE fingerprint = ?').bind(fingerprint).first()) return;
    console.error(JSON.stringify({ event: 'email_store_failed', error: error instanceof Error ? error.name : 'Error' }));
    throw error;
  }
  return id;
}

export async function getRaw(env: Env, id: string): Promise<ArrayBuffer | null> {
  const { results } = await env.DB.prepare('SELECT data FROM raw_chunks WHERE message_id = ? ORDER BY part')
    .bind(id).all<{ data: ArrayBuffer | number[] }>();
  if (!results.length) return null;
  const chunks = results.map(row => new Uint8Array(row.data as ArrayBuffer));
  const combined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
  return new Response(new Blob([combined]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
