import PostalMime from 'postal-mime';
import { recordEvent } from './operations';
import { convert } from 'html-to-text';
import { sha256 } from './auth';
import type { Env } from './types';
import { verificationFields } from './message-index';
import type { AttachmentMeta } from '../shared/types';
import { reserveDelivery, storageFull } from './abuse';

export const MAX_EMAIL_BYTES = 10 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const encoder = new TextEncoder();
export const MIME_OPTIONS = { maxNestingDepth: 32, maxHeadersSize: 64 * 1024, forceRfc822Attachments: true } as const;

async function readMail(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

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
  const address = await env.DB.prepare('SELECT blocked FROM addresses WHERE address=?').bind(recipient).first<{ blocked: number }>();
  if (!address || address.blocked) { message.setReject('This recipient is not accepting messages.'); return; }
  if (!Number.isSafeInteger(message.rawSize) || message.rawSize < 1 || message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject('Message exceeds the supported size limit.'); return;
  }
  if (await storageFull(env)) { await recordEvent(env, 'storage_full'); message.setReject('Mailbox storage limit reached.'); return; }
  if (!await reserveDelivery(env, recipient, message.rawSize)) {
    await recordEvent(env, 'mail_limited');
    message.setReject('Mailbox delivery limit reached. Please contact the recipient before resending.'); return;
  }
  const bytes = await readMail(message.raw as unknown as ReadableStream<Uint8Array>, message.rawSize);
  if (!bytes) { message.setReject('Message exceeds its declared size.'); return; }
  const fingerprint = await sha256(recipient + ':' + await sha256(bytes));
  const duplicate = await env.DB.prepare('SELECT id FROM messages WHERE fingerprint = ?').bind(fingerprint).first();
  if (duplicate) return;

  let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    parsed = await PostalMime.parse(bytes, MIME_OPTIONS);
  } catch {
    // Preserve the exact original even when a malformed message cannot be parsed.
    parsed = {
      headers: [], headerLines: [], attachments: [],
      subject: message.headers.get('Subject') || '(제목 없음)',
      text: '본문을 표시할 수 없습니다. 원본 파일을 내려받아 확인해 주세요.',
    };
  }
  if (parsed.attachments.length > 100) { message.setReject('Too many attachments.'); return; }
  const id = crypto.randomUUID();
  const received = Date.now();
  const html = parsed.html || '';
  const storedHtml = truncateBytes(html, 900 * 1024);
  const text = parsed.text || (storedHtml ? convert(storedHtml, { wordwrap: false,
    limits: { maxInputLength: 900 * 1024, maxDepth: 64, maxChildNodes: 10_000 },
    selectors: [{ selector: 'img', format: 'skip' }] }) : '');
  const storedText = truncateBytes(text, 128 * 1024);
  const attachments: AttachmentMeta[] = (parsed.attachments || []).map((a, index) => ({
    index, filename: (a.filename || `attachment-${index + 1}`).slice(0, 255),
    mimeType: a.mimeType.slice(0, 255), size: typeof a.content === 'string' ? a.content.length : a.content.byteLength,
  }));
  const gzip = await new Response(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const compressed = new Uint8Array(gzip);
  const verification = verificationFields(parsed.subject || '', storedText, storedHtml);
  const sender = (parsed.from?.address || message.from).slice(0, 320).toLowerCase();
  const rule = await env.DB.prepare('SELECT action FROM sender_rules WHERE sender=?').bind(sender).first<{ action: string }>();
  const queries = [
    env.DB.prepare(`INSERT INTO messages (
      id, recipient, sender_address, sender_name, subject, preview, body_text, body_html,
      attachments, received_at, sent_at, raw_size, stored_size, body_truncated, fingerprint,
      verification_code, is_verification, verification_version, category, category_source, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(id, recipient, sender,
        (parsed.from?.name || '').slice(0, 256), (parsed.subject || '(제목 없음)').slice(0, 1024),
        storedText.replace(/\s+/g, ' ').trim().slice(0, 220) || '메일을 열어 내용을 확인하세요.',
        storedText, storedHtml, JSON.stringify(attachments), received, parsed.date || null,
        bytes.byteLength, compressed.length + encoder.encode(storedText + storedHtml + JSON.stringify(attachments)).length + 2048,
        Number(storedText !== text || storedHtml !== html), fingerprint, verification.code, verification.verified,
        rule?.action === 'promotions' ? 'promotions' : 'inbox', rule ? 'manual' : verification.verified ? 'protected' : 'pending', rule?.action === 'trash' ? received : null),
  ];
  for (let offset = 0, part = 0; offset < compressed.length; offset += CHUNK_BYTES, part++) {
    queries.push(env.DB.prepare('INSERT INTO raw_chunks (message_id, part, data) VALUES (?, ?, ?)')
      .bind(id, part, compressed.slice(offset, offset + CHUNK_BYTES).buffer));
  }
  try { await env.DB.batch(queries); }
  catch (error) {
    if (error instanceof Error && error.message.includes('mail_storage_full')) {
      message.setReject('Mailbox storage limit reached.'); return;
    }
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
