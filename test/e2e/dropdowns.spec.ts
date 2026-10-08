import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page, context }, info) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `203.0.113.${180 + info.line % 50}` });
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  expect((await context.request.post('/api/login', { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' }, data: credentials })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '메일함', exact: true })).toBeVisible();
});

test('folder menu supports keyboard selection, cancellation, focus return and all folders', async ({ page }) => {
  const trigger = page.getByRole('combobox', { name: '메일함', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: '안 읽은 메일', exact: true })).toBeFocused();
  await page.screenshot({ path: '.local/dropdowns-desktop.png', animations: 'disabled' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('End'); await expect(page.getByRole('option', { name: '휴지통', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
  await expect(trigger).toHaveText('휴지통'); await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/folder=trash/);
  await page.keyboard.press('Space'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toHaveText('휴지통'); await expect(trigger).toBeFocused();
  for (const label of ['받은 메일', '인증 메일', '별표', '보관함', '안 읽은 메일', '광고와 소식', '전체 메일', '휴지통']) {
    await trigger.click(); await page.getByRole('option', { name: label, exact: true }).click();
    await expect(trigger).toHaveText(label); await expect(page.getByRole('heading', { name: label, exact: true })).toBeAttached();
  }
  await trigger.click();
  await page.getByRole('listbox').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
  await page.mouse.click(1000, 90);
  await expect(page.getByRole('listbox')).toHaveCount(0); await expect(trigger).toHaveText('휴지통');
});

test('rule menu stays above the native dialog and Escape only closes the current layer', async ({ page }) => {
  await page.goto('/?settings=rules');
  await page.getByRole('button', { name: '규칙 추가' }).click();
  const dialog = page.getByRole('dialog');
  await page.getByLabel('보낸 사람 이메일').fill('draft@example.net');
  const trigger = page.getByRole('combobox', { name: '이동할 메일함' });
  await trigger.click();
  await expect(dialog.getByRole('listbox')).toBeVisible();
  await page.screenshot({ path: '.local/dropdowns-dialog.png', animations: 'disabled' });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible(); await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused(); await expect(trigger).toHaveText('광고와 소식');
  await expect(page.getByLabel('보낸 사람 이메일')).toHaveValue('draft@example.net');
  await trigger.click(); await page.getByRole('option', { name: '받은 메일', exact: true }).click();
  await expect(trigger).toHaveText('받은 메일');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test.describe('touch', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  test('folder choices fit a small screen and select with touch', async ({ page }) => {
    const trigger = page.getByRole('combobox', { name: '메일함', exact: true });
    await trigger.tap();
    await page.screenshot({ path: '.local/dropdowns-mobile.png', animations: 'disabled' });
    const box = (await page.getByRole('listbox').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(568);
    for (const option of await page.getByRole('option').all()) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('option', { name: '휴지통', exact: true }).tap();
    await expect(trigger).toHaveText('휴지통'); await expect(page).toHaveURL(/folder=trash/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
