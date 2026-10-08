import { test, expect, chromium, firefox, webkit } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

for (const [index, engine] of [chromium, firefox, webkit].entries()) {
  test(`${engine.name()}에서 로그인·검색·설정·키보드 이동을 사용할 수 있다`, async () => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:8787',
      viewport: { width: index === 0 ? 1440 : 375, height: 900 },
      permissions: [],
      extraHTTPHeaders: { 'CF-Connecting-IP': `192.0.2.${60 + index}` },
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.name));
      const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
      await page.goto('/');
      await page.getByLabel('아이디', { exact: true }).fill(credentials.username);
      await page.getByLabel('비밀번호', { exact: true }).fill(credentials.password);
      await page.getByRole('button', { name: '로그인', exact: true }).click();
      await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
      const start = await page.evaluate(() => performance.now());
      await page.getByRole('combobox', { name: '메일함' }).click();
      await page.getByRole('option', { name: '전체 메일', exact: true }).click();
      await expect(page.getByRole('heading', { name: '전체 메일', exact: true })).toBeAttached();
      const interactionMs = (await page.evaluate(() => performance.now())) - start;
      await page.getByRole('button', { name: '상세 검색', exact: true }).click();
      await expect(page.getByLabel('검색어', { exact: true })).toBeFocused();
      await page.getByLabel('이 날짜부터').fill('2026-01-01');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '상세 검색', exact: true })).toBeFocused();
      await page.getByRole('button', { name: '설정', exact: true }).click();
      await page.getByRole('button', { name: '계정', exact: true }).click();
      await page.locator('.account-password > summary').click();
      await expect(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const audit = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(audit.violations.map((item) => item.id)).toEqual([]);
      expect(errors).toEqual([]);
      const metrics = await page.evaluate(() => ({
        paints: performance
          .getEntriesByType('paint')
          .map((entry) => ({ name: entry.name, ms: Math.round(entry.startTime) })),
        scriptBytes: performance
          .getEntriesByType('resource')
          .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'script')
          .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).encodedBodySize, 0),
      }));
      await writeFile(
        `.local/metrics-${engine.name()}.json`,
        JSON.stringify(
          { browser: engine.name(), interactionMs: Math.round(interactionMs), ...metrics },
          null,
          2,
        ),
      );
      await page.screenshot({ path: `.local/compatibility-${engine.name()}.png`, fullPage: true });
      await page.getByRole('button', { name: '이 기기에서 로그아웃', exact: true }).click();
      await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
