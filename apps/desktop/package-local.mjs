/** Build an isolated installer containing the local shell, never user data. */
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const output = resolve(process.argv[2] || join(root, 'release-local'))
const stage = join(output, 'shell')
mkdirSync(stage, { recursive: true })
copyFileSync(join(root, 'lib', 'local-main.js'), join(stage, 'main.js'))
for (const file of readdirSync(join(root, 'lib')).filter(name => /^config-.*\.js$/.test(name))) {
  copyFileSync(join(root, 'lib', file), join(stage, file))
}
const electron = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8'))
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'leon-desktop-local', productName: 'Leon Desktop', version: '0.1.1',
  description: 'Aplicativo desktop para o ambiente Leon em D:\\Leon',
  author: 'The Lions Informática', private: true, type: 'module', main: 'main.js',
  build: {
    appId: 'br.com.thelions.leon.local', productName: 'Leon Desktop',
    electronVersion: electron.version, electronDist: dirname(require('electron')),
    directories: { output: join(output, 'installer') },
    files: ['main.js', 'config-*.js', 'package.json'], asar: true, npmRebuild: false,
    win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'Leon-Desktop-Setup-${version}.${ext}', signAndEditExecutable: false },
    nsis: { oneClick: false, perMachine: false, allowElevation: false,
      allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
      createStartMenuShortcut: true, shortcutName: 'Leon Desktop',
      deleteAppDataOnUninstall: false, runAfterFinish: false },
  },
}, null, 2) + '\n')
execFileSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--projectDir', stage, '--win', '--publish', 'never'], { stdio: 'inherit' })
