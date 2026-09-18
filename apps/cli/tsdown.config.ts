import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `bin` referenced by package.json `bin` plus the public
 * in-process desktop host entry. The root tsdown build does not infer app
 * subpaths from package exports, so this override names both emitted entries.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/{bin,desktop}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
