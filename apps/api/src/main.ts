import { loadEnv } from './config/env';
import { createApp } from './app';

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const app = await createApp({ env });
  await app.listen(env.API_PORT, '0.0.0.0');
};

bootstrap().catch((e: unknown) => {
  console.error('api failed to start', e);
  process.exit(1);
});
