import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const fromEnv = (key: string, fallback: string): string => process.env[key] ?? fallback;
// Redis of the test run (the local compose Redis by default); every suite uses its own database number on it
const redisBase = fromEnv('TEST_REDIS_BASE', 'redis://127.0.0.1:56379');

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 60_000,
    env: {
      DB_HOST: fromEnv('DB_HOST', '127.0.0.1'),
      DB_PORT: fromEnv('DB_PORT', '55432'),
      DB_USER: fromEnv('DB_USER', 'hotel'),
      DB_PASSWORD: fromEnv('DB_PASSWORD', 'change-me-db-password'),
      // tests never touch the database docker compose runs: `pnpm test` creates and migrates this one
      DB_NAME: fromEnv('TEST_DB_NAME', 'hotel_test'),
      REDIS_URL: `${redisBase}/1`,
      TEST_REDIS_BASE: redisBase,
      CHANNEL_API_KEY: fromEnv('CHANNEL_API_KEY', 'change-me-channel-api-key'),
      CHANNEL_HMAC_SECRET: fromEnv('CHANNEL_HMAC_SECRET', 'change-me-channel-hmac-secret'),
    },
  },
});
