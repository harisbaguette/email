import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
  })],
  test: {
    include: ['test/*.test.ts'], fileParallelism: false,
    deps: { optimizer: { ssr: { enabled: true, include: ['sanitize-html'] } } },
  },
});
