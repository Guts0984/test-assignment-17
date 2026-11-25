import { parseEnv } from './config/env';
import { createStub } from './server';

const env = parseEnv(process.env);
const server = createStub(env);
server.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`channel stub on :${env.port} chaos=${env.chaos} targets=${env.targets.join(',')}\n`);
});
const stop = (): void => {
  server.close(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
