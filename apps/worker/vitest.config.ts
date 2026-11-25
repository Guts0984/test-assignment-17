import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const fromEnv = (key: string, fallback: string): string => process.env[key] ?? fallback;

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
      DB_NAME: fromEnv('DB_NAME', 'hotel'),
      REDIS_URL: fromEnv('REDIS_URL', 'redis://127.0.0.1:56379'),
      CHANNEL_API_KEY: fromEnv('CHANNEL_API_KEY', 'change-me-channel-api-key'),
      CHANNEL_HMAC_SECRET: fromEnv('CHANNEL_HMAC_SECRET', 'change-me-channel-hmac-secret'),
    },
  },
});
