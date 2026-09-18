import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/local-main.ts'],
  external: ['electron'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
