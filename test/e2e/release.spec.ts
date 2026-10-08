import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('본문 건너뛰기·보안 기록·텍스트 간격 변경을 작은 화면에서도 사용할 수 있다', async ({ page, context }) => {
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': '192.0.2.159' });
  const response = await context.request.post('/api/login', { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' }, data: credentials });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '본문으로 이동' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mail-content')).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: '* { letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important; } p { margin-bottom: 2em !important; }' });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(await fits()).toBe(true);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  for (const name of ['이메일 주소', '알림', '자동 정리', '계정']) {
    await page.getByRole('button', { name, exact: true }).click();
    expect(await fits()).toBe(true);
  }
  await page.getByText('최근 보안 기록', { exact: true }).click();
  await expect(page.locator('.security-history li').first()).toBeVisible();
  await expect(page.locator('.security-history')).toContainText('로그인');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(await fits()).toBe(true);
  await page.screenshot({ path: '.local/release/security-history-320.png', fullPage: true });
});
