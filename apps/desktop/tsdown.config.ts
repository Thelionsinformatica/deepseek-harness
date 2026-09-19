import { defineConfig } from 'tsdown'

const shared = {
  external: ['electron'],
  outDir: 'lib',
  format: ['esm' as const],
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

// Each entry is built alone so rolldown inlines shared chunks: packaged Electron
// cannot resolve relative ESM imports inside app.asar.
export default defineConfig([
  { ...shared, entry: ['src/local-main.ts'] },
  { ...shared, entry: ['src/main.ts'] },
])
