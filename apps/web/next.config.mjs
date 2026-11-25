/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  transpilePackages: ['@hotel/shared'],
  experimental: { externalDir: true },
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
