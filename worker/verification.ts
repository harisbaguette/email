import { Parser } from 'htmlparser2';
import type { VerificationLink } from '../shared/types';

const actionLabel = /(?:이메일|메일|계정|가입).{0,12}(?:인증|확인|완료|활성화)|(?:인증|확인).{0,8}(?:하기|완료)|(?:verify|confirm|activate).{0,25}(?:email|address|account|registration)|(?:email|account).{0,20}(?:verification|confirmation)|メール.{0,12}(?:確認|認証)|登録を完了/i;

export function verificationLink(subject: string, text: string, html: string): VerificationLink | null {
  const links = new Map<string, VerificationLink>();
  const add = (raw: string, label: string) => {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.href.length > 4096) return;
      const host = url.hostname.toLowerCase();
      if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost' || host.startsWith('[') || /^[\d.]+$/.test(host)) return;
      links.set(url.href, { url: url.href, host: url.hostname, label: label.trim().slice(0, 80) || '이메일 확인' });
    } catch { /* A relative or malformed link is not a usable verification shortcut. */ }
  };
  if (html) {
    // Stream the labels instead of recursively walking an attacker-controlled DOM.
    let anchor: { href: string; label: string } | null = null;
    const parser = new Parser({
      onopentag(name, attrs) { if (name === 'a') anchor = { href: attrs.href || '', label: '' }; },
      ontext(value) { if (anchor) anchor.label += value.slice(0, Math.max(0, 256 - anchor.label.length)); },
      onclosetag(name) {
        if (name !== 'a' || !anchor) return;
        const label = anchor.label.replace(/\s+/g, ' ').trim();
        if (actionLabel.test(label)) add(anchor.href, label);
        anchor = null;
        if (links.size > 1) parser.pause();
      },
    }, { decodeEntities: true });
    parser.end(html);
  }
  if (links.size === 0 && actionLabel.test(subject)) {
    const urls = [...text.matchAll(/https:\/\/[^\s<>"']+/gi)].map(match => match[0].replace(/[).,;]+$/, ''));
    const unique = [...new Set(urls)];
    if (unique.length === 1) add(unique[0], '이메일 확인');
  }
  return links.size === 1 ? [...links.values()][0] : null;
}
