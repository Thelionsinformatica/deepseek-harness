# llama.cpp リクエスト画像の互換性

[English](2026-09-14-llamacpp-request-image-png.md) | 中文

ローカルの qwen3.5-2b endpoint は合成 PNG を受理し（HTTP 200）、同等の WebP を拒否した（HTTP 400: Failed to load image or audio file）。影響を受ける会話には過去の WebP スクリーンショットが含まれる。Markdown アップロードはメディアではなくテキストブロックである。

プロバイダオプション `requestImageOutputFormat: png` は決定論的な PNG リクエスト版を選択する。保存済み添付とセッションログは変更されない。フォーマットはキャッシュ同一性とキャッシュ検証に含まれ、ピクセルとバイトの上限も引き続き適用される。他のルートは従来どおりの動作を保持する。

フォーカスしたテストで、原本保存・透過 WebP 変換・キャッシュ分離と再利用・設定検証をカバーする。実会話全体のライブリプレイは合成 endpoint プローブとは別物である。
