import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('public/brand', { recursive: true });
const symbol = await readFile('public/brand/symbol.svg', 'utf8');
const paths = `<g fill="none">${symbol.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</g>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#F1F4F8"/><g transform="translate(77 77) scale(5.6)">${paths}</g></svg>`;
const favicon = icon.replace('<rect width="512"', '<rect rx="112" width="512"');
await writeFile('public/brand/favicon.svg', favicon);
for (const size of [192, 512]) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`public/brand/icon-${size}.png`);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('public/brand/apple-touch-icon.png');
await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile('public/brand/favicon-32.png');
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 272 80"><g transform="translate(0 8)">${paths}</g><text x="77" y="50" fill="#24314A" font-family="Arial,sans-serif" font-size="38" font-weight="600" letter-spacing="-1.7">mailroom</text></svg>`;
await writeFile('public/brand/logo.svg', logo);
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#F1F4F8"/><rect x="75" y="72" width="1050" height="486" rx="40" fill="#FFFFFF"/><g transform="translate(146 170) scale(3.7)">${paths}</g><text x="423" y="305" fill="#24314A" font-family="Arial,sans-serif" font-weight="600" font-size="94" letter-spacing="-5">mailroom</text><text x="428" y="371" fill="#637087" font-family="Arial,sans-serif" font-size="27">email.bluekite.co.kr</text></svg>`;
await sharp(Buffer.from(og)).png().toFile('public/brand/social-card.png');
const badge = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path d="M18 23h60a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10H18A10 10 0 0 1 8 73V33a10 10 0 0 1 10-10Zm-2 10 28 22a7 7 0 0 0 8 0l28-22-4-5-28 22-28-22Z" fill="white" fill-rule="evenodd"/></svg>';
await sharp(Buffer.from(badge)).resize(96, 96).png().toFile('public/brand/notification-badge.png');
console.log('Mailroom brand assets generated.');
