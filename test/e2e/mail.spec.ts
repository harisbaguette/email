import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cleanupFixtures } from './helpers';
import AxeBuilder from '@axe-core/playwright';

const fixtures: string[] = [];
test.afterEach(async () => { await cleanupFixtures(fixtures.splice(0)); });

test('private inbox: create address, receive MIME, read, search, download, restore, mobile and logout', async ({ page, request, context }) => {
  const { password, username } = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  const errors: string[] = [];
  const trackingRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://tracker.invalid/**', async route => {
    trackingRequests.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64') });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  expect((await request.get('/api/inbox')).status()).toBe(401);
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '안 읽은 메일', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: '새 주소', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('주소 이름')).toHaveCount(0);
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  const local = `check-${Date.now()}`; fixtures.push(local);
  await page.getByLabel('주소 이름').fill(local);
  await page.getByRole('button', { name: '만들고 복사' }).click();
  await expect(page.getByLabel('주소 이름')).toHaveCount(0);
  await page.getByRole('button', { name: '수신함', exact: true }).click();
  await expect(page.getByRole('heading', { name: '안 읽은 메일', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('address')).toBe(false);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${local}@bluekite.co.kr`);

  const subject = 'Bluekite 수신 확인';
  const raw = [
    'From: Bluekite Test <test@example.net>', `To: ${local}@bluekite.co.kr`,
    `Message-ID: <${local}@example.net>`, `Date: ${new Date().toUTCString()}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="test-boundary"', '',
    '--test-boundary', 'Content-Type: multipart/alternative; boundary="body-boundary"', '',
    '--body-boundary', 'Content-Type: text/plain; charset=utf-8', '',
    'Bluekite 수신 확인. 인증번호는 482913입니다. https://example.com/verify',
    '--body-boundary', 'Content-Type: text/html; charset=utf-8', '',
    '<style>.verification { background-color: #2458ce; color: #fff; padding: 10px; display: inline-block; }</style><table style="width:640px;min-width:640px"><tr><td><h1>Bluekite 수신 확인</h1><p>인증번호는 <strong>482913</strong>입니다.</p><a class="verification" href="https://example.com/verify">이메일 확인</a><img src="https://tracker.invalid/pixel.png"><script>window.parent.hacked=true</script><img src="x" onerror="window.parent.hacked=true"><a href="javascript:alert(1)">unsafe</a></td></tr></table>',
    '--body-boundary--', '--test-boundary', 'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="hello.txt"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('Hello, Bluekite!').toString('base64'), '--test-boundary--', '',
  ].join('\r\n');
  const sent = await request.post(`/cdn-cgi/handler/email?from=test@example.net&to=${local}@bluekite.co.kr`, { data: raw, headers: { 'Content-Type': 'text/plain' } });
  expect(sent.ok(), await sent.text()).toBeTruthy();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  const row = page.locator('.row-open').filter({ hasText: subject }).filter({ hasText: local });
  await expect(row).toBeVisible();
  const beforeOpen = new URL(page.url()).searchParams.get('message');
  await row.locator('..').getByRole('button', { name: /인증번호 복사/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('482913');
  expect(new URL(page.url()).searchParams.get('message')).toBe(beforeOpen);
  await row.click();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /이메일 확인 링크 열기/ })).toHaveAttribute('href', 'https://example.com/verify');
  await expect(page.getByRole('link', { name: /이메일 확인 링크 열기/ })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('link', { name: /이메일 확인 링크 열기/ }).click();
  await expect(page.getByRole('dialog', { name: '링크 주소 확인' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('example.com', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click();
  await page.getByRole('button', { name: '인증번호 복사', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('482913');
  const frame = page.frameLocator('iframe[title="메일 본문"]');
  await expect(frame.getByText('482913', { exact: true })).toBeVisible();
  await expect(frame.locator('script')).toHaveCount(0);
  await expect(frame.getByRole('link', { name: '이메일 확인' })).toHaveAttribute('target', '_blank');
  await expect(frame.getByRole('link', { name: '이메일 확인' })).toHaveCSS('background-color', 'rgb(36, 88, 206)');
  await expect(frame.getByRole('link', { name: '이메일 확인' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(frame.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { hacked?: boolean }).hacked)).toBeUndefined();
  expect(trackingRequests).toHaveLength(0);
  await page.getByRole('button', { name: '외부 이미지 표시' }).click();
  await expect.poll(() => trackingRequests.length).toBe(1);

  await page.getByLabel('메일 작업', { exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: '메일 원본 다운로드' }).click()]);
  expect(await readFile((await download.path())!, 'utf8')).toBe(raw);
  const [attachment] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /hello.txt/ }).click()]);
  expect(await readFile((await attachment.path())!, 'utf8')).toBe('Hello, Bluekite!');
  await page.getByLabel('메일 작업', { exact: true }).click();
  await page.getByRole('button', { name: '광고와 소식으로 이동', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('combobox', { name: '메일함' }).click(); await page.getByRole('option', { name: '광고와 소식', exact: true }).click();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByLabel('메일 작업', { exact: true }).click();
  await expect(page.getByRole('button', { name: '광고 아님', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/promotions-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '광고 아님', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('combobox', { name: '메일함' }).click(); await page.getByRole('option', { name: '받은 메일', exact: true }).click();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('heading', { name: subject, exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/inbox-desktop.png', fullPage: true, animations: 'disabled' });
  // Audit our UI; arbitrary sender HTML runs in a script-disabled, opaque-origin frame.
  const desktopAudit = await new AxeBuilder({ page }).exclude('iframe').options({ iframes: false })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(desktopAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('button', { name: '메일 목록으로' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await frame.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.screenshot({ path: '.local/inbox-mobile-detail.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '메일 목록으로' }).click();
  await expect(row).toBeVisible();
  await page.screenshot({ path: '.local/inbox-mobile-list.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('482913');
  await expect(row).toBeVisible();
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('존재하지않는검색어');
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible();
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('');
  await row.click();
  await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('휴지통');
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await page.getByRole('combobox', { name: '메일함' }).click(); await page.getByRole('option', { name: '휴지통', exact: true }).click();
  await row.click();
  await page.getByRole('button', { name: '영구 삭제', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '수신함으로 복원' }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  const generatedLocal = await page.getByLabel('주소 이름').inputValue();
  fixtures.push(generatedLocal);
  expect(generatedLocal).toMatch(/^[bdfghjkmnprstvz][aeou][bdfghjkmnprstvz][aeou][2-9]{2}$/);
  await expect(page.getByLabel('주소 이름')).toBeFocused();
  await page.screenshot({ path: '.local/address-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '만들고 복사' }).click();
  await expect(page.getByLabel('주소 이름')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${generatedLocal}@bluekite.co.kr`);
  await page.getByRole('button', { name: '수신함', exact: true }).click();
  await page.getByRole('combobox', { name: '메일함' }).click(); await page.getByRole('option', { name: '받은 메일', exact: true }).click();
  await expect(row).toBeVisible();
  expect(new URL(page.url()).searchParams.has('address')).toBe(false);
  await page.screenshot({ path: '.local/waiting-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await page.getByText('보관과 개인정보', { exact: true }).click();
  await expect(page.getByText(/메일은 자동 삭제하지 않습니다/)).toBeVisible();
  await page.getByRole('button', { name: '이 기기에서 로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  expect((await context.request.get('/api/inbox')).status()).toBe(401);
  expect(errors).toEqual([]);
});
