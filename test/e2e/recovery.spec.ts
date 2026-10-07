import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page, context }, testInfo) => {
  // Distinct local clients keep recovery tests independent of login throttling.
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `192.0.2.${10 + testInfo.line % 240}` });
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  await page.goto('/');
  await page.getByLabel('아이디', { exact: true }).fill(credentials.username);
  await page.getByLabel('비밀번호', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});

test('a pending search never closes settings or erases an address draft', async ({ page }) => {
  await page.clock.install();
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('verification');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.clock.runFor(400);
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  await page.getByLabel('주소 이름').fill('draft-unsaved');
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: '이메일 주소', exact: true }).click();
  await expect(page.getByLabel('주소 이름')).toHaveValue('draft-unsaved');
});

test('folder errors never show messages from the previous folder', async ({ page, context }) => {
  const data = await (await context.request.get('/api/inbox')).json();
  const message = { id: '00000000-0000-4000-8000-000000000001', recipient: 'hi@bluekite.co.kr', sender_name: '받은 메일 발신자', sender_address: 'sender@example.net', subject: '원래 수신함의 메일', is_read: 0, received_at: Date.now(), attachments: [], verification_code: null };
  await context.route('**/api/inbox?**', route => {
    const folder = new URL(route.request().url()).searchParams.get('folder');
    return folder === 'inbox' ? route.fulfill({ json: { ...data, messages: [message] } }) : route.fulfill({ status: 503, json: { error: '연결을 확인해 주세요.' } });
  });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByText(message.subject)).toBeVisible();
  await page.getByRole('combobox', { name: '메일함' }).selectOption('trash');
  await expect(page.getByRole('alert')).toContainText('연결을 확인');
  await expect(page.getByText(message.subject)).not.toBeVisible();
});

test('expired push connections offer reconnection instead of a stale connected state', async ({ page, context }) => {
  const id = 'ab'.repeat(32);
  await context.route('**/api/push', route => route.fulfill({ json: { configured: true, publicKey: '', devices: [{ id, mode: 'verification', preview: 0 }] } }));
  // Test a stale server subscription without creating any real notification connection.
  await page.evaluate(id => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    crypto.subtle.digest = async () => new Uint8Array(Array(32).fill(171)).buffer;
    PushManager.prototype.getSubscription = async () => ({ endpoint: 'https://fcm.googleapis.com/example', unsubscribe: async () => true }) as PushSubscription;
  }, id);
  await context.route(`**/api/push/${id}/test`, route => route.fulfill({ status: 410, json: { error: '알림 연결이 만료되었습니다. 다시 켜 주세요.' } }));
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: '알림 보내기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('만료');
  await expect(page.getByRole('button', { name: '켜기', exact: true })).toBeVisible();
  await expect(page.getByText('연결됨', { exact: true })).not.toBeVisible();
});

test('session network failures can be retried without asking for credentials again', async ({ page, context }) => {
  await context.route('**/api/session', route => route.fulfill({ status: 503, json: { error: '잠시 연결할 수 없습니다.' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: '연결할 수 없습니다' })).toBeVisible();
  await expect(page.getByLabel('비밀번호', { exact: true })).toHaveCount(0);
  await context.unroute('**/api/session');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});

test('empty logout requests revoke the session', async ({ context }) => {
  const response = await context.request.post('/api/logout', { headers: { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' } });
  expect(response.status()).toBe(200);
  expect((await context.request.get('/api/inbox')).status()).toBe(401);
});

test('unexpected server HTML is reported instead of becoming a broken empty inbox', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/inbox?**', route => route.fulfill({ contentType: 'text/html', body: '<html>Connection interrupted</html>' }));
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('서버 응답을 확인하지 못했습니다');
  expect(errors).toEqual([]);
});

test('stalled requests time out with a retry action', async ({ page, context }) => {
  await page.clock.install();
  let started!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  await context.route('**/api/inbox?**', () => { started(); });
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await pending;
  await page.clock.runFor(15001);
  await expect(page.getByRole('alert')).toContainText('연결이 지연');
  await expect(page.getByRole('button', { name: '다시 시도', exact: true })).toBeEnabled();
});

test('focus events during subscription never overwrite the newly connected device', async ({ page, context }) => {
  const id = 'ab'.repeat(32);
  let gets = 0;
  await page.evaluate(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Notification.requestPermission = async () => 'granted';
    PushManager.prototype.getSubscription = async () => ({ endpoint: 'https://fcm.googleapis.com/example', toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/example' }) }) as PushSubscription;
  });
  await context.route('**/api/push', async route => {
    if (route.request().method() === 'POST') {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await route.fulfill({ json: { id } });
    } else { gets++; await route.fulfill({ json: { configured: true, publicKey: '', devices: [] } }); }
  });
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: '켜기', exact: true }).click();
  await expect(page.getByText('연결됨', { exact: true })).toBeVisible();
  expect(gets).toBe(1);
});

test('account loading failures recover without clearing the password draft', async ({ page, context }) => {
  await context.route('**/api/settings', route => route.fulfill({ status: 503, json: { error: '계정 정보를 불러오지 못했습니다.' } }));
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('계정 정보를 불러오지');
  await page.getByLabel('현재 비밀번호', { exact: true }).fill('unsaved-password');
  await context.unroute('**/api/settings');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('현재 비밀번호', { exact: true })).toHaveValue('unsaved-password');
});
