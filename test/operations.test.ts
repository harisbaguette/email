/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordEvent, operationStatus, finishScheduled } from '../worker/operations';
import worker from '../worker/index';
import type { Env } from '../worker/types';

const bindings = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
const testEnv = { ...bindings, MONITOR_TOKEN: 'test-only-'.repeat(5), API_LIMITER: { limit: async () => ({ success: true }) } } as Env;
beforeAll(() => applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS));
beforeEach(async () => {
  await bindings.DB.batch(['security_events', 'monitor_state', 'login_attempts'].map(t => bindings.DB.prepare(`DELETE FROM ${t}`)));
});
describe('operations and privacy', () => {
  it('authenticates monitoring before reading the database and never grants mail access', async () => {
    const db = { prepare: vi.fn(() => { throw new Error('must not read'); }) } as unknown as D1Database;
    const denied = await worker.fetch(new Request('https://email.bluekite.co.kr/api/monitor'), { ...testEnv, DB: db });
    expect(denied.status).toBe(401); expect(db.prepare).not.toHaveBeenCalled();
    await finishScheduled(testEnv);
    const headers = { Authorization: `Bearer ${testEnv.MONITOR_TOKEN}` };
    const monitor = await worker.fetch(new Request('https://email.bluekite.co.kr/api/monitor', { headers }), testEnv);
    expect(monitor.status).toBe(200); expect((await monitor.json() as any).ok).toBe(true);
    const mail = await worker.fetch(new Request('https://email.bluekite.co.kr/api/inbox', { headers }), testEnv);
    expect(mail.status).toBe(401);
  });
  it('detects stale jobs, database error signals and a distributed login attack', async () => {
    expect((await operationStatus(testEnv)).issues).toContain('scheduled_jobs_stale');
    await finishScheduled(testEnv);
    await recordEvent(testEnv, 'mail_error');
    await bindings.DB.prepare("INSERT INTO login_attempts VALUES ('account',20,?)").bind(Date.now()).run();
    expect((await operationStatus(testEnv)).issues).toEqual(['login_attack', 'mail_error']);
  });
  it('bounds the audit data and preserves only typed events, timestamps and correlation IDs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await Promise.all(Array.from({ length: 25 }, () => recordEvent(testEnv, 'login_failed')));
      const rows = (await bindings.DB.prepare('SELECT * FROM security_events').all()).results;
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(['kind', 'request_id', 'window_start']);
      const entry = JSON.parse(spy.mock.calls[0][0]);
      expect(Object.keys(entry).sort()).toEqual(['event', 'level', 'requestId', 'timestamp']);
      expect(entry.requestId).toMatch(/^[a-f0-9-]{36}$/);
    } finally { spy.mockRestore(); }
    await bindings.DB.prepare("INSERT INTO security_events VALUES ('mail_error',0,'expired')").run();
    await finishScheduled(testEnv);
    expect(await bindings.DB.prepare('SELECT 1 FROM security_events WHERE window_start=0').first()).toBeNull();
  });
});
