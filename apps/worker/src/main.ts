import { Logger } from '@nestjs/common';
import { loadEnv } from './config/env';
import { createWorkerApp } from './app';

const bootstrap = async (): Promise<void> => {
  const log = new Logger('worker');
  const app = await createWorkerApp({ env: loadEnv() });
  log.log('worker started');
  const stop = (signal: string) => (): void => {
    log.log(`${signal}: finishing running jobs`);
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', stop('SIGTERM'));
  process.once('SIGINT', stop('SIGINT'));
};

bootstrap().catch((e: unknown) => {
  new Logger('worker').error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
