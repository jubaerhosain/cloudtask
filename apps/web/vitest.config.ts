import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only; Playwright specs under e2e/ run via `pnpm test:e2e`.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
