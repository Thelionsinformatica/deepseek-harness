import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/mission-control.js', 'lib/types/execution.js',
    'lib/types/import-lab.js', 'lib/types/lab-bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
