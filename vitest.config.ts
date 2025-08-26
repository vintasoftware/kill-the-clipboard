import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist'],
    typecheck: {
      enabled: true,
      tsconfig: './test/tsconfig.json',
    },
    coverage: {
      reporter: ['text', 'html', 'lcov', 'json-summary', 'json'],
      include: ['src/'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        '**/*.d.ts',
        'rollup.config.js',
        'vitest.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
