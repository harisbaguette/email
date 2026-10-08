import sanitizeHtml from 'sanitize-html';

export function emailDocument(html: string, allowImages: boolean) {
  const clean = sanitizeHtml(html, {
    nestingLimit: 64,
    // Email templates use stylesheet classes for verification buttons. This document is
    // isolated by iframe sandbox and CSP: no scripts, external stylesheets, forms or navigation of the parent.
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'center', 'font', 'style'],
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': ['style', 'class', 'dir', 'lang'],
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['width', 'cellpadding', 'cellspacing', 'border', 'align', 'bgcolor'],
      tr: ['bgcolor'],
      td: ['width', 'height', 'colspan', 'rowspan', 'align', 'valign', 'bgcolor'],
      th: ['width', 'colspan', 'rowspan', 'align', 'bgcolor'],
      font: ['color', 'size', 'face'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' } }),
      img: (_tag, attrs) => {
        const src = attrs.src || '';
        const embedded = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(src);
        if (!embedded && !(allowImages && src.startsWith('https://'))) {
          return { tagName: 'span', attribs: {}, text: attrs.alt || '' };
        }
        return { tagName: 'img', attribs: attrs };
      },
    },
  });
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    :root { color-scheme: light; }
    body { margin: 0; padding: 24px; color: #253044; font: 16px/1.65 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif; overflow-wrap: anywhere; }
    img { max-width: 100% !important; height: auto; }
    table { max-width: 100% !important; }
    a { color: #2458ce; text-decoration: underline; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    @media(max-width:500px) {
      body { padding: 16px; }
      table, td, th, div { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box; }
      table { width: 100% !important; table-layout: fixed !important; }
      td, th { overflow-wrap: anywhere; }
    }
  </style></head><body>${clean}</body></html>`;
}

export function emailHeaders(allowImages: boolean) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:${allowImages ? ' https:' : ''}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox`,
  };
}
