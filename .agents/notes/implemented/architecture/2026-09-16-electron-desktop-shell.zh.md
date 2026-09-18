# Agent Note: Electron デスクトップシェル — 既存 Web ホスト上のネイティブウィンドウ

Status: implemented

[English](2026-09-16-electron-desktop-shell.md) | 中文

## Problem

Leon は完全な Web クライアントとローカル Cordis ホストをすでに提供している。デスクトップ配布には、ネイティブウィンドウ・ローカルのライフサイクル管理・Windows インストーラーが必要であり、Web UI の複製やレンダラーのファイルシステムアクセスの弱化は行わない。

## Decision

`apps/desktop`（`@deepseek-ai/dsh-desktop`）は Electron アプリケーションである。そのメインプロセスは公開 `@deepseek-ai/dsh/desktop` エントリをインポートし、出荷済み `web` profile を `127.0.0.1` の OS 割り当てポートでインプロセス起動し、そのオリジンを強化 `BrowserWindow` に読み込む。

レンダラーは `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` を使う。同一オリジン内の遷移はウィンドウ内に留まる。外部ナビゲーションは OS が開き、Node.js アクセスは渡さない。

デスクトップエントリは既存の Web 起動サービスに `--no-open`、`--host 127.0.0.1`、`--port 0` を渡す。Cordis の `ProcessShutdown` コントローラが Electron 終了前にホストを破棄するため、ネイティブウィンドウを閉じてもローカルサーバーは残らない。

パッケージターゲットは Windows NSIS x64 で、アプリケーション ID は `br.com.thelions.leon`。シェルは既存の `$DSH_HOME`・profile・資格情報・workspace 設定・権限・セッション永続化を再利用する。追加のネイティブ API には明示的な preload bridge が必要で、レンダラーの Node 統合経由で公開してはならない。

Windows パッケージ版は起動時に Electron の login-item API を通じて `openAtLogin` を登録する。開発起動では自動起動を登録せず、ログイン項目はユーザーセッション開始後に通常のデスクトップウィンドウを開く。

## Alternatives considered

**独立したネイティブ UI は却下。** 既存の React サーフェスを再実装すると、セッション描画・RPC 動作・アクセシビリティロジックが重複する。

**子プロセス `dsh` は却下。** ホストを Electron メインプロセスに置くことでシェルのライフサイクル所有者が一つになり、シャットダウン時にシグナルやポート検出の競合なく Cordis ツリーを破棄できる。

**Tauri は見送り。** ランタイムサイズは削減できるが、既存の Node ホストにデスクトップライフサイクル契約がない段階で第二のネイティブツールチェーンを導入することになる。

## Consequences

デスクトップビルドは Electron に依存し、現在 Windows NSIS x64 を対象とする。レンダラーは loopback の Web クライアントのままなので、ブラウザとデスクトップは同じホストを共有し、既存の Web テストで検証できる。本パッケージは private で npm リリースファミリーから除外され、インストーラーは electron-builder で別途生成する。

## Verification

`apps/desktop/tests/config.spec.ts` が同一オリジンと外部ナビゲーションの判定をカバーする。Web profile がビルド済みフロントエンド配布物を解決するため、デスクトップシェルの起動前にリポジトリビルドが完了している必要がある。`pnpm run desktop:package` はリポジトリをビルドし、シェルをコンパイルし、Windows インストーラー用に electron-builder を呼び出す。
