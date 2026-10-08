import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { cleanupFixtures, registerFixtureAddress } from './helpers';

const fixtures: string[] = [];
test.afterEach(async () => { await cleanupFixtures(fixtures.splice(0)); });

test('unread is home; sender identity and recipient chips stay clear across screen sizes', async ({ page, context }) => {
  const headers = { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1', 'CF-Connecting-IP': '203.0.113.231' };
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  expect((await context.request.post('/api/login', { headers, data: credentials })).ok()).toBe(true);
  const local = `chip-${Date.now()}`; fixtures.push(local);
  await registerFixtureAddress(context.request, local);
  for (let i = 0; i < 2; i++) {
    expect((await context.request.post(`/cdn-cgi/handler/email?from=accounts@example.net&to=${local}@bluekite.co.kr`, {
      headers: { 'Content-Type': 'text/plain' },
      data: `From: Example Accounts <accounts@example.net>\r\nTo: ${local}@bluekite.co.kr\r\nMessage-ID: <${local}-${i}@example.net>\r\nSubject: Login verification ${i}\r\nContent-Type: text/plain\r\n\r\nLogin code: 482913. Request ${i}`,
    })).ok()).toBe(true);
  }
  const messages = (await (await context.request.get(`/api/inbox?folder=all&address=${local}@bluekite.co.kr`)).json()).messages;
  expect((await context.request.patch(`/api/messages/${messages[0].id}`, { headers, data: { action: 'read' } })).ok()).toBe(true);
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: '메일함', exact: true });
  await expect(picker).toHaveText('안 읽은 메일');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await expect(page.locator('.row-sender')).toHaveText('Example Accounts');
  await expect(page.locator('.row-sender-address')).toHaveText('accounts@example.net');
  await expect(page.locator('.recipient-address')).toHaveText(`${local}@bluekite.co.kr`);
  await picker.click(); await page.getByRole('option', { name: '받은 메일', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await page.reload(); await expect(picker).toHaveText('받은 메일');
  await expect(page.locator('.mail-row')).toHaveCount(2);
  for (const width of [1440, 500, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const folderBox = (await picker.boundingBox())!;
    const settingsBox = (await page.getByRole('button', { name: '설정', exact: true }).boundingBox())!;
    expect(Math.abs(folderBox.y - settingsBox.y)).toBeLessThan(3);
    expect(folderBox.x + folderBox.width).toBeLessThanOrEqual(settingsBox.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    if (width === 1440 || width === 375) await page.screenshot({ path: `.local/identity-${width}.png`, animations: 'disabled' });
  }
  await page.getByRole('button', { name: '안 읽은 메일로 이동', exact: true }).click();
  await expect(picker).toHaveText('안 읽은 메일'); await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.locator('.row-open').click();
  await expect(page.locator('.sender-email')).toHaveText('accounts@example.net');
  await expect(page.locator('.recipient-copy .recipient-address')).toHaveText(`${local}@bluekite.co.kr`);
  await page.getByRole('button', { name: '메일 목록으로', exact: true }).click();
  await expect(page.getByRole('heading', { name: '메일이 없습니다', exact: true })).toBeVisible();
});
