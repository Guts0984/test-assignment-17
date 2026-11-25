import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const fromEnv = (key: string, fallback: string): string => process.env[key] ?? fallback;

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      LOG_LEVEL: 'error',
      RATE_LIMIT_GLOBAL_PER_MIN: '100000',
      DB_HOST: fromEnv('DB_HOST', '127.0.0.1'),
      DB_PORT: fromEnv('DB_PORT', '55432'),
      DB_USER: fromEnv('DB_USER', 'hotel'),
      DB_PASSWORD: fromEnv('DB_PASSWORD', 'change-me-db-password'),
      DB_NAME: fromEnv('DB_NAME', 'hotel'),
      REDIS_URL: fromEnv('REDIS_URL', 'redis://127.0.0.1:56379'),
      JWT_SECRET: fromEnv('JWT_SECRET', 'change-me-jwt-secret-at-least-32-characters'),
      CHANNEL_API_KEY: fromEnv('CHANNEL_API_KEY', 'change-me-channel-api-key'),
      CHANNEL_HMAC_SECRET: fromEnv('CHANNEL_HMAC_SECRET', 'change-me-channel-hmac-secret'),
    },
  },
});
