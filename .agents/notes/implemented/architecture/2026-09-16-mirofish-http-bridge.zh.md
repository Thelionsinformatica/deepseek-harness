# Agent Note: Leon 向け MiroFish HTTP ブリッジ

Status: implemented

[English](2026-09-16-mirofish-http-bridge.md) | 中文

## Problem

Leon は上流アプリケーションを組み込まずに MiroFish の群衆シミュレーションレポートを利用する必要がある。MiroFish は AGPL-3.0 で、独自の Python 環境・LLM API・Zep Cloud 設定を持ち、シミュレーションのライフサイクルは長時間かつリソース負荷が高い。そのソースを Leon ツリーへコピーすると、ライセンス・ランタイム・ハーネスが所有できないアップグレード負担を取り込むことになる。

## Alternatives considered

- **MiroFish ソースをリポジトリへ vendor 化**——却下: AGPL-3.0 が所有しないコードへ及び、Python ランタイムと Docker スタックがハーネスの保守対象依存になる。
- **Leon から MiroFish プロセスを管理**——却下: Docker の起動・依存のインストール・MiroFish 資格情報の保持は運用者の責務であり、ブリッジはそれらを Leon の外に置く。
- **独立稼働するバックエンドへの HTTP ブリッジ**——採用: 運用者が MiroFish を実行し、Leon は公開 API のみを呼び、ライセンス境界は wire 上に留まる。

## Decision

Leon は出荷済み Leon preset を通じてのみ `mirofish_simulate` ツールを公開する。ツールは別途稼働する MiroFish Flask バックエンドを公開 HTTP API 経由で呼び、MiroFish ソースのコピー・Docker の起動・Python 依存のインストール・MiroFish 資格情報の保存は行わない。

ワークフローはオントロジー生成・グラフ構築・シミュレーション準備・シミュレーション実行・レポート生成である。非同期のグラフ・準備・シミュレーション・レポート各段階は、共有 AbortSignal・リクエスト単位のタイムアウト・段階単位の待機上限・デフォルト 40 ラウンド上限でポーリングされる。

## Safety

シードテキストは設定済み MiroFish バックエンドへアップロードされるため、実行は最初のリクエスト前に共有承認サービスを呼ぶ。承認が拒否・キャンセル・利用不可の場合は失敗側に倒れる。ツールは出力を確定的な予測ではなくシミュレーションレポートとして説明する。

デフォルト endpoint は `http://127.0.0.1:5001` で、上流バックエンドのコンテナポート割り当てに一致する。汎用 Web bundle は依存を保持し、Leon preset が保守的な上限でツールを有効化する。他の profile では公開しない。

## Consequences

Leon のインストールでは MiroFish を独立して実行し、必要な LLM と Zep の設定を用意しなければならない。MiroFish は独自のフロントエンド・バックエンド・Python 環境・運用ライフサイクルを持つ AGPL-3.0 アプリケーションのままである。ブリッジは Leon リポジトリ内で private かつ MIT ライセンスであり、MiroFish API のみを通じて通信する。

ツールはプロジェクト・グラフ・シミュレーション・レポートの各識別子と有界の Markdown レポート内容を返す。MiroFish のプロジェクトやレポートの削除・Zep の直接変更・シミュレーション由来の graph-memory 更新は行わない。

## Verification

keyless テストが URL 正規化と成功/エラーのレスポンスエンベロープをカバーする。型チェックとパッケージビルドがツールスキーマ・承認呼び出し・API ワークフロー・バンドル登録をカバーする。ライブスモークテストには有効な LLM と Zep 資格情報を持つ稼働中の MiroFish バックエンドが必要で、デフォルトの keyless スイートには含まれない。
