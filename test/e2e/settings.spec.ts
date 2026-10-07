import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

test.use({ channel: 'chromium' });

test('settings on desktop and mobile; simulated subscription, push display and notification navigation', async ({ page, context }) => {
  const { username, password } = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  await context.grantPermissions(['notifications', 'clipboard-read', 'clipboard-write']);
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-simulated', keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.from(pair.x!, 'base64url'), Buffer.from(pair.y!, 'base64url')]).toString('base64url'), auth: Buffer.from(randomBytes(16)).toString('base64url'),
  } };
  await page.addInitScript(value => {
    let enabled = sessionStorage.getItem('test-push-enabled') === '1';
    const fake = { ...value, toJSON: () => value, unsubscribe: async () => { enabled = false; sessionStorage.removeItem('test-push-enabled'); return true; } };
    PushManager.prototype.getSubscription = async () => enabled ? fake as unknown as PushSubscription : null;
    PushManager.prototype.subscribe = async () => { enabled = true; sessionStorage.setItem('test-push-enabled', '1'); return fake as unknown as PushSubscription; };
  }, subscription);
  await page.goto('/');
  await page.getByLabel('아이디', { exact: true }).fill(username);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('button', { name: '이메일 주소', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: '.local/settings-desktop.png', fullPage: true });
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of ['이메일 주소', '알림', '계정']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(audit.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))).toEqual([]);
      if (width === 375) await page.screenshot({ path: `.local/settings-${tab}-mobile.png`, fullPage: true });
    }
  }
  await page.getByLabel('현재 비밀번호', { exact: true }).fill('wrong-local-password');
  await page.getByLabel('새 비밀번호', { exact: true }).fill('local-new-password');
  await page.getByLabel('새 비밀번호 확인', { exact: true }).fill('local-different-password');
  await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('새 비밀번호가 서로 다릅니다.');
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: '켜기', exact: true }).click();
  await expect(page.getByText('연결됨', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: '내용 미리보기' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('combobox', { name: '알림 받을 메일' }).selectOption('inbox');
  await expect(page.getByRole('status')).toHaveText('저장됨');
  await page.getByRole('switch', { name: '내용 미리보기' }).click();
  await expect(page.getByRole('switch', { name: '내용 미리보기' })).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const sw = context.serviceWorkers()[0];
  // Simulate the browser's decrypted push delivery, not a real mobile push service.
  await sw.evaluate(async () => {
    const event = new (self as any).PushEvent('push', { data: JSON.stringify({ title: '인증 메일 도착', body: 'Bluekite에서 확인할 수 있습니다.', url: '/?settings=notifications', tag: 'e2e-push' }) });
    const work: Promise<unknown>[] = [];
    event.waitUntil = (promise: Promise<unknown>) => work.push(promise);
    self.dispatchEvent(event);
    await Promise.all(work);
  });
  await expect.poll(() => sw.evaluate(async () => (await (self as any).registration.getNotifications({ tag: 'e2e-push' })).length)).toBe(1);
  const displayed = await sw.evaluate(async () => { const item = (await (self as any).registration.getNotifications({ tag: 'e2e-push' }))[0]; return { title: item.title, body: item.body, url: item.data.url }; });
  expect(displayed).toEqual({ title: '인증 메일 도착', body: 'Bluekite에서 확인할 수 있습니다.', url: '/?settings=notifications' });
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await sw.evaluate(async () => { const item = (await (self as any).registration.getNotifications({ tag: 'e2e-push' }))[0]; self.dispatchEvent(new (self as any).NotificationEvent('notificationclick', { notification: item })); });
  await expect(page).toHaveURL(/settings=notifications/);
  await expect(page.getByRole('heading', { name: '알림', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '끄기', exact: true }).click();
  await expect(page.getByRole('button', { name: '켜기', exact: true })).toBeVisible();
  expect((await (await context.request.get('/api/push')).json()).devices).toEqual([]);
  await page.evaluate(() => { PushManager.prototype.subscribe = async () => { throw new DOMException('Registration failed', 'NotAllowedError'); }; });
  await page.getByRole('button', { name: '켜기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('시크릿 창이라면 일반 창');
  await page.getByRole('button', { name: '수신함', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});
