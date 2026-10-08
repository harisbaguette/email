import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test.use({
  baseURL: 'http://localhost:8787',
  extraHTTPHeaders: { 'CF-Connecting-IP': '203.0.113.170' },
});

test('register once, use device unlock to sign in, and remove the passkey', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '가상 인증기는 Chromium CDP에서 검증합니다.');
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const headers = {
    Origin: 'http://127.0.0.1:8787',
    'X-Bluekite-Request': '1',
    'CF-Connecting-IP': '203.0.113.170',
  };
  let keyId = '';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('/?settings=account');
    await page.getByLabel('아이디', { exact: true }).fill(credentials.username);
    await page.getByLabel('비밀번호', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '계정', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '패스키 추가', exact: true })).toBeEnabled();
    const registered = page.waitForResponse((r) =>
      r.url().endsWith('/api/passkeys/register/verify'),
    );
    await page.getByRole('button', { name: '패스키 추가', exact: true }).click();
    expect((await registered).status()).toBe(200);
    await expect(page.locator('.passkey-list li')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const list = await context.request.get('/api/passkeys');
    keyId = (await list.json()).passkeys[0].id;
    expect(
      (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials,
    ).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: '.local/passkeys-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '이 기기에서 로그아웃', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '기기 잠금으로 로그인', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('아이디', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.local/passkey-login-mobile.png', fullPage: true });
    await page.evaluate(() => {
      const get = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.get = async (options) => {
        navigator.credentials.get = get;
        throw new DOMException('User cancelled', 'NotAllowedError');
      };
    });
    await page.getByRole('button', { name: '기기 잠금으로 로그인', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '기기 잠금으로 로그인', exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: '비밀번호로 로그인', exact: true }).click();
    await expect(page.getByLabel('아이디', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '기기 잠금으로 로그인', exact: true }).click();
    await expect(page.getByRole('heading', { name: '계정', exact: true })).toBeVisible();
    await page
      .locator('.passkey-list')
      .getByRole('button', { name: /패스키 삭제/ })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.locator('.passkey-list li')).toHaveCount(0);
    keyId = '';
    await page.getByRole('button', { name: '이 기기에서 로그아웃', exact: true }).click();
    await expect(page.getByLabel('아이디', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (keyId) {
      await context.request.post('/api/login', { headers, data: credentials });
      const removed = await context.request.delete('/api/passkeys/' + keyId, {
        headers,
        data: { password: credentials.password },
      });
      expect(removed.status()).toBe(200);
    }
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});
