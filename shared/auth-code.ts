export function normalizeAuthCode(value: string) {
  return value.normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '').replace(/[‐‑‒–—−]/g, '-');
}
