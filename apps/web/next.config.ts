import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output is used by the production Docker image (Milestone 7).
  output: 'standalone',
  // The monorepo root, so Next traces workspace files correctly for standalone.
  outputFileTracingRoot: `${process.cwd()}/../..`,
  reactStrictMode: true,
  // Linting is run separately via Turbo (`pnpm lint`), not during `next build`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
