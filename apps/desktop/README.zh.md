# Leon Desktop

[English](README.md) | 中文

デスクトップシェルは既存の Leon Web profile を Electron の `BrowserWindow` 内で実行する。Cordis ホストは Electron メインプロセスに留まり、loopback の OS 割り当てポートのみにバインドし、アプリケーション終了前に破棄される。

## 開発

Web フロントエンド配布物が存在するよう、先にリポジトリをビルドしてからシェルを起動する:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

シェルは `dsh --profile web` と同じ `$DSH_HOME`・提供方資格情報・workspace 設定・profile・権限・セッション永続化を使う。ホストをネットワークへ公開せず、第二のブラウザウィンドウも開かない。

## Windows での自動起動

パッケージ版 Windows アプリケーションは、Windows ユーザーセッション開始時に自動起動するよう登録される。この登録はインストール版でのみ有効で、`pnpm ... dev` では登録されず、ログイン後に通常のウィンドウを開く。

## Windows パッケージ

ビルド成功後に NSIS インストーラーを作成する:

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop package
```

最初のパッケージは意図的に第二の UI 実装ではなく WebView シェルとした。ネイティブ統合は Electron のメインプロセス、または `contextIsolation` を有効にした preload bridge を通じて追加すること。レンダラーコードに Node.js アクセスを与えてはならない。
