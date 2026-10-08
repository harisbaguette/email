import { test, expect, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { cleanupFixtures, registerFixtureAddress } from './helpers';

const fixtures: string[] = [];
const headers = { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' };
test.beforeEach(async ({ context, page }, info) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `198.51.100.${30 + (info.line % 200)}` });
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  expect((await context.request.post('/api/login', { headers, data: credentials })).ok()).toBe(
    true,
  );
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});
test.afterEach(async () => cleanupFixtures(fixtures.splice(0)));
async function message(context: BrowserContext) {
  const local = `system-${Date.now()}`;
  fixtures.push(local);
  await registerFixtureAddress(context.request, local);
  const result = await context.request.post(
    `/cdn-cgi/handler/email?from=system@example.net&to=${local}@bluekite.co.kr`,
    {
      headers: { 'Content-Type': 'text/plain' },
      data: `From: System <system@example.net>\r\nSubject: System check\r\nMessage-ID: <${local}@example.net>\r\nContent-Type: text/plain\r\n\r\nHello.`,
    },
  );
  expect(result.ok()).toBe(true);
  const inbox = await (
    await context.request.get(`/api/inbox?folder=all&address=${local}@bluekite.co.kr`)
  ).json();
  return inbox.messages[0].id as string;
}

test('공통 조작 높이와 색을 유지하며 320px·확대·키보드로 검색할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  for (const selector of ['[data-ui="icon-button"]', '[data-ui="select"]', '[data-ui="input"]']) {
    for (const control of await page.locator(selector).all()) {
      if (await control.isVisible())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  const trigger = page.getByRole('button', { name: '상세 검색', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '상세 검색' });
  await expect(page.getByLabel('검색어', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel('검색어', { exact: true })).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.addStyleTag({ content: 'html { zoom: 2; }' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.addStyleTag({ content: 'html { zoom: 1; }' });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(
    audit.violations.map((item) => ({
      id: item.id,
      targets: item.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('설정 폼과 모달이 같은 입력·버튼 규격을 사용하고 키보드 메뉴가 복원된다', async ({ page }) => {
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  const create = page.getByRole('button', { name: '만들고 복사' });
  const style = await create.evaluate((node) => {
    const s = getComputedStyle(node);
    return [s.borderRadius, s.backgroundColor, s.minHeight];
  });
  await page.getByRole('button', { name: '자동 정리', exact: true }).click();
  await page.getByRole('button', { name: '규칙 추가' }).click();
  const dialog = page.getByRole('dialog');
  expect(
    await dialog.getByRole('button', { name: '추가', exact: true }).evaluate((node) => {
      const s = getComputedStyle(node);
      return [s.borderRadius, s.backgroundColor, s.minHeight];
    }),
  ).toEqual(style);
  await page.getByRole('combobox', { name: '이동할 메일함' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('combobox', { name: '이동할 메일함' })).toBeFocused();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations.map((item) => item.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '규칙 추가' })).toBeFocused();
});

test('자동 읽음 응답을 기다린 뒤 작업하고 느린 응답이 별표를 되돌리지 않는다', async ({
  page,
  context,
}) => {
  const id = await message(context);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/messages/${id}`, async (route) => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON()?.action === 'read') {
      await gate;
    }
    await route.continue();
  });
  await page.goto(`/?folder=all&message=${id}`);
  const star = page.getByRole('button', { name: '별표 표시', exact: true });
  await expect(star).toBeVisible();
  await expect(star).toBeDisabled();
  release();
  await expect(star).toBeEnabled();
  await star.click();
  await expect(page.getByRole('button', { name: '별표 해제', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: '별표 해제', exact: true })).toBeVisible();
});

test('영구 삭제 대기 중 모달을 유지하고 실패를 모달 안에 표시한다', async ({ page, context }) => {
  const id = await message(context);
  await context.request.patch(`/api/messages/${id}`, { headers, data: { action: 'trash' } });
  await page.goto(`/?folder=trash&message=${id}`);
  const trigger = page.getByRole('button', { name: '영구 삭제', exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/messages/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await gate;
    await route.fulfill({ status: 503, json: { error: '연결을 확인한 뒤 다시 시도해 주세요.' } });
  });
  await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole('alert')).toContainText('다시 시도');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(trigger).toBeFocused();
  expect((await context.request.get(`/api/messages/${id}`)).ok()).toBe(true);
});

test('지난 목록 요청을 취소하고 HTML 형식의 401 응답에서도 로그인 화면으로 복구한다', async ({
  page,
}) => {
  let started!: () => void, release!: () => void;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aborted = false;
  page.on('requestfailed', (request) => {
    if (request.url().includes('q=slow')) aborted = true;
  });
  await page.route('**/api/inbox?**', async (route) => {
    if (!route.request().url().includes('q=slow')) return route.continue();
    started();
    await gate;
    await route.fulfill({ status: 503, json: { error: '지난 검색 오류' } }).catch(() => {});
  });
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('slow');
  await begun;
  await page.getByRole('searchbox', { name: '메일 검색' }).fill('new');
  await expect.poll(() => aborted).toBe(true);
  release();
  await expect(page.getByText('지난 검색 오류')).toHaveCount(0);
  await page.unroute('**/api/inbox?**');
  await page.route('**/api/inbox?**', (route) =>
    route.fulfill({ status: 401, contentType: 'text/html', body: '<h1>Expired</h1>' }),
  );
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
});

test('브라우저 알림 정리가 멈춰도 서버 로그아웃 뒤 메일 화면을 벗어난다', async ({
  page,
  context,
}) => {
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '계정', exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem('bluekite-push-id', 'a'.repeat(64));
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    navigator.serviceWorker.getRegistration = () =>
      new Promise<ServiceWorkerRegistration | undefined>(() => {});
  });
  await page.getByRole('button', { name: '이 기기에서 로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  expect((await (await context.request.get('/api/session')).json()).authenticated).toBe(false);
});
