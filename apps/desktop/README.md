# Leon Desktop

English | [中文](README.zh.md)

The desktop shell runs the existing Leon Web profile inside an Electron `BrowserWindow`. The Cordis host remains in the Electron main process, binds only to a loopback OS-assigned port, and is disposed before the application exits.

## Development

Build the repository first so the Web frontend distribution exists, then start the shell:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

The shell uses the same `$DSH_HOME`, provider credentials, workspace settings, profiles, permissions, and session persistence as `dsh --profile web`. It does not expose the host on the network and does not open a second browser window.

## Automatic startup on Windows

The packaged Windows application registers itself to start automatically when the Windows user session begins. This registration is enabled only for the installed build, not for `pnpm ... dev`, and the application opens its normal window after login.

## Windows package

Create an NSIS installer after a successful build:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop package
```

The first package is intentionally a WebView shell rather than a second UI implementation. Native integrations should be added through Electron's main process or a preload bridge with `contextIsolation` enabled; renderer code must not receive Node.js access.
