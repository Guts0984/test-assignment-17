import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createApp } from '../app';
import { loadEnv } from '../config/env';

/** Writes the OpenAPI document the web client is generated from. Usage: node dist/scripts/generate-openapi.js <out.json> */
const run = async (): Promise<void> => {
  const out = resolve(process.argv[2] ?? 'openapi.json');
  const app = await createApp({ env: loadEnv(), docs: true });
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}/docs-json`);
  const doc: unknown = await res.json();
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  await app.close();
  process.exit(0);
};

run().catch((e: unknown) => {
  console.error('openapi generation failed', e);
  process.exit(1);
});
