import { test, expect, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { cleanupFixtures } from './helpers';

const fixtures: string[] = [];
const headers = { Origin: 'http://127.0.0.1:8787', 'X-Bluekite-Request': '1' };
test.beforeEach(async ({ page, context }, info) => {
  await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': `203.0.113.${100 + info.line % 100}` });
  const credentials = JSON.parse(await readFile('.local/local-access.json', 'utf8'));
  expect((await context.request.post('/api/login', { headers, data: credentials })).ok()).toBe(true);
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
});
test.afterEach(async () => { await cleanupFixtures(fixtures.splice(0)); });
async function send(context: BrowserContext, local: string, index: number) {
  const response = await context.request.post(`/cdn-cgi/handler/email?from=friction@example.net&to=${local}@bluekite.co.kr`, { headers: { 'Content-Type': 'text/plain' }, data: `From: Bluekite Team <friction@example.net>\r\nTo: ${local}@bluekite.co.kr\r\nMessage-ID: <${local}-${index}@example.net>\r\nSubject: Verification ${index}\r\nContent-Type: text/plain\r\n\r\nLogin code: AB12CD. Message ${index}` });
  expect(response.ok()).toBe(true);
}

test('advanced filters reopen as fields, replace existing values and preserve address/folder context', async ({ page, context }) => {
  const local = `filters-${Date.now()}`; fixtures.push(local);
  await send(context, local, 1);
  const address = `${local}@bluekite.co.kr`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await page.goto(`/?folder=all&address=${address}`);
  await page.getByRole('button', { name: '상세 검색', exact: true }).click();
  await page.getByLabel('보낸 사람', { exact: true }).fill('Bluekite Team');
  await page.getByLabel('이 날짜부터', { exact: true }).fill(today);
  await page.getByLabel('이 날짜까지', { exact: true }).fill(today);
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: '상세 검색', exact: true }).click();
  await expect(page.getByLabel('보낸 사람', { exact: true })).toHaveValue('Bluekite Team');
  await expect(page.getByLabel('이 날짜까지', { exact: true })).toHaveValue(today);
  await expect(page.getByLabel('검색어', { exact: true })).toHaveValue('');
  await page.getByLabel('보낸 사람', { exact: true }).fill('nobody@example.net');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '메일 검색' })).not.toHaveValue(/Bluekite/);
  await expect(page.getByRole('button', { name: '검색 지우기', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '메일함' }).selectOption('verification');
  await expect(page.getByRole('searchbox', { name: '메일 검색' })).toHaveValue(/nobody/);
  await expect(page.getByRole('button', { name: '주소 필터 해제' })).toBeVisible();
  await page.getByRole('button', { name: '주소 필터 해제' }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toHaveValue('verification');
  await expect(page.getByRole('searchbox', { name: '메일 검색' })).toHaveValue(/nobody/);
  await page.getByRole('button', { name: '검색 지우기', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: '상세 검색', exact: true }).click();
  await page.getByLabel('이 날짜부터', { exact: true }).fill('2026-10-20');
  await page.getByLabel('이 날짜까지', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: '검색', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('시작 날짜');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/friction-search.png', fullPage: true });
});

test('unread navigation remains stable; row selection stays in the list and archive can be undone', async ({ page, context }) => {
  const local = `reading-${Date.now()}`; fixtures.push(local);
  for (let n = 0; n < 3; n++) await send(context, local, n);
  await page.goto(`/?folder=unread&address=${local}@bluekite.co.kr`);
  await expect(page.locator('.mail-row')).toHaveCount(3);
  const ids = await page.locator('.mail-row').evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.messageId!));
  await page.locator('.row-open').first().click();
  await expect.poll(async () => (await (await context.request.get(`/api/messages/${ids[0]}`)).json()).is_read).toBe(1);
  await page.getByRole('button', { name: '다음 메일', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(ids[1]));
  await page.getByRole('button', { name: '메일 목록으로', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toHaveValue('unread');
  await page.goForward(); await expect(page).toHaveURL(new RegExp(ids[1]));
  await page.getByLabel('메일 작업', { exact: true }).click();
  await page.getByRole('button', { name: '안 읽음으로 표시', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await page.getByRole('button', { name: '메일 선택', exact: true }).click();
  await page.locator('.row-open').first().click();
  await expect(page.locator('.mail-row.is-selected')).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: '현재 목록 선택' })).toHaveJSProperty('indeterminate', true);
  await expect(page.getByRole('button', { name: '메일 목록으로', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '선택한 메일 보관', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('combobox', { name: '메일함' }).selectOption('archive');
  await expect(page.locator('.mail-row')).toHaveCount(1);
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  await expect(page.locator('.mail-row')).toHaveCount(0);
  await page.getByRole('combobox', { name: '메일함' }).selectOption('unread');
  await expect(page.locator('.mail-row')).toHaveCount(2);
  await page.locator('.row-open').first().click();
  await page.getByLabel('메일 작업', { exact: true }).click();
  await page.getByRole('button', { name: '보관함으로 이동', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '메일함' })).toBeVisible();
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
  expect((await (await context.request.get(`/api/inbox?folder=archive&address=${local}@bluekite.co.kr`)).json()).messages).toHaveLength(0);
  await context.request.patch(`/api/messages/${ids[0]}`, { headers, data: { action: 'trash' } });
  await page.goto(`/?folder=trash&message=${ids[0]}`); await expect(page.getByRole('button', { name: '영구 삭제', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(audit.violations).toEqual([]);
  await page.screenshot({ path: '.local/friction-detail.png', fullPage: true });
});

test('address drafts survive leaving settings and blocked addresses explicitly resume before copying', async ({ page, context }) => {
  const local = `address-${Date.now()}`; fixtures.push(local); const address = `${local}@bluekite.co.kr`;
  await send(context, local, 0);
  await context.request.patch('/api/addresses', { headers, data: { address, blocked: true } });
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  await page.getByLabel('주소 이름', { exact: true }).fill(address);
  await expect(page.getByLabel('주소 이름', { exact: true })).toHaveValue(local);
  await page.getByRole('button', { name: '수신함', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByLabel('주소 이름', { exact: true })).toHaveValue(local);
  await page.getByRole('button', { name: '수신 재개하고 복사', exact: true }).click();
  await expect(page.getByRole('button', { name: `${address} 복사`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${address} 복사`, exact: true }).locator('.address-text')).toHaveText(address);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  const result = await (await context.request.get('/api/inbox')).json();
  expect(result.addresses.find((item: any) => item.address === address)).toMatchObject({ blocked: 0, hidden: 0, managed: 1 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: '.local/friction-addresses.png', fullPage: true });
});

test('sender rules are editable and removal can be undone without recreating the rule', async ({ page, context }) => {
  const sender = `rule-${Date.now()}@example.net`;
  try {
    await context.request.post('/api/rules', { headers, data: { sender, action: 'promotions' } });
    await page.goto('/?settings=rules');
    await page.getByLabel(`${sender} 규칙 관리`, { exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: '수정', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('이동할 메일함', { exact: true }).selectOption('inbox');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('받은 메일로 이동', { exact: true })).toBeVisible();
    await page.getByLabel(`${sender} 규칙 관리`, { exact: true }).click();
    await page.getByRole('button', { name: '해제', exact: true }).click();
    await expect(page.getByText(sender, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '되돌리기', exact: true }).click();
    await expect(page.getByText(sender, { exact: true })).toBeVisible();
    expect((await (await context.request.get('/api/rules')).json()).rules.find((rule: any) => rule.sender === sender).action).toBe('inbox');
  } finally { await context.request.delete('/api/rules', { headers, data: { sender } }); }
});

test('address settings recover independently of malformed inbox searches without losing input', async ({ page, context }) => {
  await page.goto('/?q=after:not-a-date');
  await expect(page.getByRole('alert')).toContainText('검색 날짜');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '새 주소', exact: true }).click();
  await page.getByLabel('주소 이름', { exact: true }).fill('keep-this-draft');
  await context.route('**/api/addresses', route => route.fulfill({ status: 503, json: { error: '주소 목록을 불러오지 못했습니다.' } }));
  await page.getByRole('button', { name: '알림', exact: true }).click();
  await page.getByRole('button', { name: '이메일 주소', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('주소 목록');
  await context.unroute('**/api/addresses');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('주소 이름', { exact: true })).toHaveValue('keep-this-draft');
});
