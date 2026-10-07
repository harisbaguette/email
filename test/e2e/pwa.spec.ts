import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('branded login, installability, install fallback and private offline behavior', async ({ page, context, request }) => {
  const missing: string[] = [];
  page.on('response', response => { if (response.status() === 404 && new URL(response.url()).origin === 'http://127.0.0.1:8787') missing.push(response.url()); });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; await document.fonts.ready; });
  await page.screenshot({ path: '.local/brand-login-desktop.png', fullPage: true, animations: 'disabled' });
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  const cdp = await context.newCDPSession(page);
  const manifestResult = await cdp.send('Page.getAppManifest');
  expect(manifestResult.errors).toEqual([]);
  const manifest = JSON.parse(manifestResult.data!);
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((icon: any) => icon.sizes === '192x192')).toBeTruthy();
  expect(manifest.icons.some((icon: any) => icon.sizes === '512x512' && icon.purpose.includes('maskable'))).toBeTruthy();
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  for (const path of ['/brand/favicon.svg', '/brand/icon-512.png', '/brand/apple-touch-icon.png', '/fonts/pretendard-variable.woff2']) {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).not.toContain('text/html');
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '.local/brand-login-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  // Chromium may defer its native prompt until engagement criteria are met.
  // A fresh page with that event suppressed exercises the browser-menu fallback.
  await page.addInitScript(() => window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true));
  await page.reload();
  await page.getByRole('button', { name: '앱 설치', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Bluekite를 앱으로 설치' })).toBeVisible();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  await page.getByLabel('아이디', { exact: true }).fill(credentials.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '수신함 열기' }).click();
  await expect(page.getByRole('heading', { name: '받은 메일', exact: true })).toBeVisible();
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(item => item.url)))).flat();
  });
  expect(cached.some(url => url.includes('/api/') || url.includes('message='))).toBe(false);
  expect(cached.some(url => url.endsWith('/offline'))).toBe(true);
  expect(await page.evaluate(async () => (await caches.match('/offline'))?.redirected)).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '잠시 연결을 기다리는 중입니다' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: '수신함 다시 열기' }).click();
  await expect(page.getByRole('heading', { name: '받은 메일', exact: true })).toBeVisible();
  expect(missing).toEqual([]);
});
