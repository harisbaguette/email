import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('public/brand', { recursive: true });
const symbol = await readFile('public/brand/symbol.svg', 'utf8');
// Preserve the source SVG's fill so open strokes are not filled as polygons.
const paths = `<g fill="none">${symbol.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</g>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#111D35"/><g transform="translate(88 74) scale(5.25)">${paths}</g></svg>`;
const favicon = icon.replace('<rect width="512"', '<rect rx="112" width="512"');
await writeFile('public/brand/favicon.svg', favicon);
for (const size of [192, 512]) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(`public/brand/icon-${size}.png`);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile('public/brand/apple-touch-icon.png');
await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile('public/brand/favicon-32.png');
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 80"><g transform="translate(0 6)">${paths}</g><text x="79" y="45" fill="#111D35" font-family="Arial,sans-serif" font-size="35" font-weight="600" letter-spacing="-1.8">bluekite</text><text x="81" y="65" fill="#66748B" font-family="Arial,sans-serif" font-size="9" letter-spacing="4">MAIL</text></svg>`;
await writeFile('public/brand/logo.svg', logo);
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#111D35"/><circle cx="1100" cy="20" r="470" fill="#182B50"/><circle cx="1100" cy="20" r="330" fill="none" stroke="#345179"/><g transform="translate(78 78) scale(1.5)">${paths}</g><text x="200" y="144" fill="white" font-family="Arial,sans-serif" font-weight="600" font-size="48" letter-spacing="-2">bluekite mail</text><text x="90" y="337" fill="white" font-family="Arial,sans-serif" font-weight="600" font-size="72" letter-spacing="-3">bluekite mail</text><text x="94" y="414" fill="#AEC3E5" font-family="Arial,sans-serif" font-size="32">email.bluekite.co.kr</text></svg>`;
await sharp(Buffer.from(og)).png().toFile('public/brand/social-card.png');
console.log('Bluekite brand assets generated.');
