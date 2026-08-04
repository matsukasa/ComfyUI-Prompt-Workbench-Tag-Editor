# アーキテクチャ

## 構成

バックエンドを持たないReact SPA。ファイルはブラウザの `File` APIで読み、状態はZustandに保持し、Blobダウンロードで別名出力する。外部通信、永続化、認証はない。

## データフロー

```text
File input
  -> format detection / parser
  -> canonical CatalogDocument
  -> Zustand history store
  -> tree + virtualized kanban + header overwrite/save-as actions
  -> validation + diff summary
  -> source-specific serializer
  -> Blob download
```

`CatalogDocument` は元JSON、フォーマット情報、正規化カテゴリ、タグ出現単位を併せて持つ。パーサーとシリアライザーは同梱形式／ユーザー形式を分岐し、UIは共通モデルだけを扱う。

## ドラッグ規則

- タグ：同一小分類内の挿入、別小分類への移動、複数カテゴリからの一括移動。
- 大・中分類：タグドラッグ中は展開ナビゲーター。最終ドロップは小分類のみ。
- 大分類：大分類間で順序変更。
- 中分類：大分類または別の中分類を基準に親・順序変更。
- 小分類：中分類または別の小分類を基準に親・順序変更。
- 親移動は子孫とタグを保持し、循環とレベル違反を拒否する。

## 履歴

変更直前の `CatalogDocument` を最大100件保持する。新しい変更でRedo履歴を破棄する。選択や検索など表示状態はデータ履歴へ含めない。

## 性能

小分類列ごとにTanStack Virtualを利用し、画面内と余白行だけをDOMへ描画する。検索は表示のみに作用する。
