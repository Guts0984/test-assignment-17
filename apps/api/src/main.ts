import { loadEnv } from './config/env';
import { createApp } from './app';

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const app = await createApp({ env });
  await app.listen(env.API_PORT, '0.0.0.0');
  // docker stop: close the server and every connection (Nest runs the shutdown hooks), then exit 0.
  // The timer is the last resort, so a stuck connection can never keep the container waiting for SIGKILL.
  const stop = (): void => {
    setTimeout(() => process.exit(1), 8000).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
};

bootstrap().catch((e: unknown) => {
  console.error('api failed to start', e);
  process.exit(1);
});
