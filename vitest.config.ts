import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{js,ts}'],
    exclude: ['tests/e2e/**']
  }
});
