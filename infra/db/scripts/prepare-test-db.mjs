// Creates the database the test suites use (separate from the one docker compose runs) and migrates it.
// Safe to run again: an existing database is only migrated.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const name = process.env.TEST_DB_NAME ?? 'hotel_test';
if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
const host = process.env.DB_HOST ?? '127.0.0.1';
const port = process.env.DB_PORT ?? '55432';
const user = process.env.DB_USER ?? 'hotel';
const password = process.env.DB_PASSWORD ?? 'change-me-db-password';
const url = (db) => `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${db}`;

const admin = new PrismaClient({ datasources: { db: { url: url('postgres') } } });
try {
  const found = await admin.$queryRawUnsafe(`SELECT 1 FROM pg_database WHERE datname = '${name}'`);
  if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
} finally {
  await admin.$disconnect();
}
execFileSync(resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url(name) }, stdio: 'inherit' });
