import { test, expect, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { cleanupFixtures, registerFixtureAddress, seedPagination } from './helpers';

const fixtures: string[] = [];
test.beforeEach(async ({ page, context }, info) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.51.100.${info.line % 240 + 1}` });
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  await page.goto('/'); await page.getByLabel('아이디', { exact: true }).fill(credentials.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});
test.afterEach(async () => { await cleanupFixtures(fixtures.splice(0)); });
async function send(context: BrowserContext, local: string, index: number) {
  await registerFixtureAddress(context.request, local);
  const response = await context.request.post(`/cdn-cgi/handler/email?from=management@example.net&to=${local}@bluekite.co.kr`, { headers: { 'Content-Type': 'text/plain' }, data: `From: Example <management@example.net>\r\nTo: ${local}@bluekite.co.kr\r\nMessage-ID: <${local}-${index}@example.net>\r\nSubject: Mail ${index}\r\nContent-Type: text/plain\r\n\r\nLogin code: AB12CD. Unique ${index}` });
  expect(response.ok(), `Local SMTP simulator: ${response.status()} ${await response.text()}`).toBe(true);
}

test('live refresh preserves all loaded pages and viewport, including new mail and deleted rows', async ({ page, context }) => {
  test.setTimeout(90000);
  const local = `pagination-${Date.now()}`; fixtures.push(local);
  await send(context, local, 0);
  await seedPagination(local, 60);
  await page.goto(`/?folder=all&address=${local}@bluekite.co.kr`);
  await expect(page.locator('.mail-row')).toHaveCount(50);
  await page.getByRole('button', { name: '더 보기', exact: true }).click(); await expect(page.locator('.mail-row')).toHaveCount(61);
  const anchor = page.locator('.mail-row').nth(53); const id = await anchor.getAttribute('data-message-id');
  await anchor.scrollIntoViewIfNeeded(); const top = (await anchor.boundingBox())!.y;
  await send(context, local, 1000);
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'mail-arrived' } })));
  await expect(page.locator('.mail-row')).toHaveCount(62);
  expect(Math.abs((await page.locator(`[data-message-id="${id}"]`).boundingBox())!.y - top)).toBeLessThan(3);
  const firstId = await page.locator('.mail-row').first().getAttribute('data-message-id');
  await context.request.patch(`/api/messages/${firstId}`, { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' }, data: { action: 'trash' } });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.mail-row')).toHaveCount(61);
  await page.locator(`[data-message-id="${id}"] .row-open`).click();
  await expect(page.getByRole('button', { name: '인증번호 복사', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '메일 목록으로', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(61);
});

test('bulk star/archive/trash and undo, advanced search and narrow-screen selection are usable', async ({ page, context }) => {
  const local = `bulk-${Date.now()}`; fixtures.push(local);
  await Promise.all([0,1,2].map(n => send(context, local, n)));
  await page.goto(`/?folder=verification&address=${local}@bluekite.co.kr`);
  await expect(page.locator('.mail-row')).toHaveCount(3);
  await page.getByRole('button', { name: '메일 선택', exact: true }).click();
  await page.getByRole('checkbox', { name: '현재 목록 선택' }).check();
  await page.getByRole('button', { name: '선택한 메일 별표', exact: true }).click();
  await expect(page.locator('.row-sender .starred')).toHaveCount(3);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: '메일 선택', exact: true }).click();
  await page.getByRole('checkbox', { name: '현재 목록 선택' }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze(); expect(audit.violations).toEqual([]);
  await page.screenshot({ path: '.local/management-bulk-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '선택한 메일 삭제', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click(); await expect(page.locator('.mail-row')).toHaveCount(3);
  await page.getByRole('button', { name: '상세 검색', exact: true }).click();
  await page.getByLabel('보낸 사람', { exact: true }).fill('management@example.net');
  await page.getByRole('button', { name: '검색', exact: true }).click(); await expect(page.locator('.mail-row')).toHaveCount(3);
  await page.locator('.row-open').first().click();
  await page.getByLabel('메일 작업', { exact: true }).click(); await page.getByRole('button', { name: '보관함으로 이동', exact: true }).click();
  await page.getByRole('combobox', { name: '메일함' }).click(); await page.getByRole('option', { name: '보관함', exact: true }).click(); await expect(page.locator('.mail-row')).toHaveCount(1);
});

test('registered addresses support notes, hiding and recipient pause', async ({ page, context }) => {
  const local = `auto-${Date.now()}`; fixtures.push(local); const address = `${local}@bluekite.co.kr`;
  await send(context, local, 1); await page.goto('/?settings=addresses');
  await expect(page.locator('.settings-addresses').getByRole('button', { name: `${address} 복사`, exact: true })).toBeVisible();
  await page.getByLabel(`${address} 관리`, { exact: true }).click(); await page.getByRole('button', { name: '주소 설정', exact: true }).click();
  await page.getByLabel('메모', { exact: true }).fill('개인 인증'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('개인 인증', { exact: true })).toBeVisible();
  await page.getByLabel(`${address} 관리`, { exact: true }).click(); await page.getByRole('button', { name: '주소 설정', exact: true }).click();
  await page.getByRole('button', { name: '이 주소 수신 중지', exact: true }).click();
  await page.getByText('숨김·수신 중지', { exact: false }).click();
  await expect(page.getByText('수신 중지', { exact: true })).toBeVisible();
  const data = await (await context.request.get('/api/inbox')).json(); expect(data.addresses.find((a: any) => a.address === address).blocked).toBe(1);
});

test('another login device can be revoked while the current device remains signed in', async ({ page, context, browser }) => {
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:8787', extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.70' } });
  try {
    const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
    const response = await other.request.post('/api/login', { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' }, data: credentials }); expect(response.ok()).toBe(true);
    await page.goto('/?settings=account');
    await page.getByRole('button', { name: '다른 기기 모두 로그아웃', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await other.request.get('/api/inbox')).status()).toBe(401);
    expect((await context.request.get('/api/inbox')).status()).toBe(200);
    await page.setViewportSize({ width: 375, height: 812 }); await page.screenshot({ path: '.local/management-account-mobile.png', fullPage: true });
  } finally { await other.close(); }
});

function otp(secret: string) {
  let bits=0,value=0; const bytes:number[]=[];
  for (const char of secret) { value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits+=5; if(bits>=8){ bits-=8;bytes.push((value>>>bits)&255); } }
  const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(); const offset=digest[19]&15;
  return ((new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}

test('two-factor setup requires saved recovery codes, then login and recovery work in the browser', async ({ page, context }) => {
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  let codes:string[]=[]; let enabled=false;
  try {
    await page.goto('/?settings=account');
    await page.locator('.two-factor').getByRole('button', { name:'설정',exact:true }).click();
    await page.getByRole('dialog').getByLabel('현재 비밀번호',{exact:true}).fill(credentials.password);
    const setupResponse = page.waitForResponse(r=>r.url().endsWith('/api/two-factor/setup') && r.status()===200);
    await page.getByRole('button',{name:'계속',exact:true}).click();
    const setup=await (await setupResponse).json(); codes=setup.recoveryCodes;
    await expect(page.getByRole('img',{name:'인증 앱 등록 QR 코드'})).toBeVisible();
    await expect(page.getByRole('button',{name:'인증 켜기',exact:true})).toBeDisabled();
    const download = page.waitForEvent('download'); await page.getByRole('button',{name:'복구 코드 다운로드',exact:true}).click();
    expect((await download).suggestedFilename()).toBe('mailroom-recovery-codes.txt');
    await page.getByRole('checkbox',{name:'복구 코드를 안전한 곳에 저장했습니다.'}).check();
    await page.getByLabel('인증 앱의 6자리 코드',{exact:true}).fill(otp(setup.secret));
    await page.getByRole('button',{name:'인증 켜기',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); enabled=true;
    await expect(page.locator('.two-factor')).toContainText('복구 코드 8개 남음');
    await page.getByRole('button',{name:'이 기기에서 로그아웃',exact:true}).click();
    await page.getByLabel('아이디',{exact:true}).fill(credentials.username); await page.getByLabel('비밀번호',{exact:true}).fill(credentials.password);
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await expect(page.getByLabel('인증 앱 코드 또는 복구 코드',{exact:true})).toBeVisible();
    await page.getByLabel('인증 앱 코드 또는 복구 코드',{exact:true}).fill(codes[0]);
    await page.getByRole('button',{name:'로그인',exact:true}).click();
    await expect(page.getByRole('heading',{name:'계정',exact:true})).toBeVisible();
  } finally {
    // Revert only this test's optional factor using its own recovery credential.
    if (enabled) {
      const headers={ Origin:'http://127.0.0.1:8787','X-Bluekite-Request':'1','CF-Connecting-IP':'203.0.113.90' };
      await context.request.post('/api/login',{headers,data:{...credentials,code:codes[6]}});
      const removed=await context.request.post('/api/two-factor/disable',{headers,data:{password:credentials.password,code:codes[7]}}); expect(removed.ok()).toBe(true);
    }
  }
});
