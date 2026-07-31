import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/device.ts',
    'src/device-schema.ts',
    'src/contract-schema-validator.ts',
    'src/skill-lint.ts',
    'src/plan-lint.ts',
    'src/pair-summary.ts',
  ],
  format: ['cjs', 'esm'],
  clean: true,
  outDir: 'build',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
