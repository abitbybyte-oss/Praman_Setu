import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure modules (no React Native). Screens are
// exercised on the device; the pipeline and tamper checks live in scripts/.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/*.test.ts'],
  },
});
