# 調査対象の解析

## 調査範囲

読み取り専用で `D:\自作ComfyUIカスタムノード\ComfyUI-Prompt-Workbench` を調査した。調査開始時点で元リポジトリには既存の未コミット変更が7件あり、本アプリの作業では変更・整形・依存導入・キャッシュ生成を行わない。

## タグ設定ファイル

主ファイルは `data/tag_catalog.json`。JSON、UTF-8 BOMなし、LF改行、2スペースインデント、約1.23MB。調査時点の構成は大分類10、中分類34、小分類124、タグ3,623件だった。

ルートは次の形を持つ。

```json
{
  "schema_version": 1,
  "generated_at": "...",
  "sources": {},
  "stats": {},
  "major_categories": []
}
```

カテゴリは `major_categories[].medium_categories[].small_categories[].tags[]` の固定3階層。カテゴリは `id`、`label_ja`、任意の説明を持ち、配列順が表示順になる。タグは `id`、`name`、`post_count`、`aliases`、`rank`、`translation_ja`、場合により `source` を持つ。調査時点の同梱カタログに同名タグはなかったが、読込コードは禁止していない。

## ユーザーカタログ

`web/tag_library.js` の `libraryToStoredCatalog` は次の形式を生成する。

```json
{
  "schema": "prompt-workbench/tag-catalog",
  "version": 1,
  "categories": [{ "id": "...", "level": "major|medium|small", "parentId": "...", "en": "...", "ja": "..." }],
  "tags": [{ "id": "...", "categoryId": "...", "prompt": "...", "ja": "...", "order": 0 }]
}
```

カテゴリ階層は `level` と `parentId`、タグ所属は `categoryId`、タグ順は `order` で保持される。配列順にも意味があり、既存UIはカテゴリ順とタグ順で安定ソートする。

## 読み込みと保存

`routes.py` の `default_examples_path` は `data/tag_catalog.json` を優先し、なければ `data/prompt_examples.json` を使う。`load_examples_catalog` はUTF-8としてJSONを読み込む。`GET /prompt_all_in_one/examples` が内容をUIへ返す。

ユーザーカタログはComfyUIのユーザーディレクトリ配下 `prompt_workbench/tag_catalogs` へ保存される。`POST /prompt_all_in_one/catalogs` は4MB、カテゴリ最大500、タグ最大10,000、必須スキーマ、空でないカテゴリIDとタグ文字列を検証する。Python側は排他的作成モード `x` を使用するため、同名ファイルを上書きしない。

## 実装上の注意

- タグ文字列を分割、翻訳、NFKC正規化しない。
- 成人向け語を含む場合も不透明な文字列として扱い、HTMLとして描画しない。
- 重複は検出のみ行い、自動削除しない。
- 同梱形式とユーザー形式は構造が異なるため、専用アダプターを分ける。
- コメント付きJSONではなく標準JSONなのでASTは不要。元オブジェクトを保持し、既知フィールドだけ差し替える方式で未知プロパティを維持できる。
- JSONの重複キーは `JSON.parse` 時に失われるため、安全に維持できない。
- `translations.json` と `prompt_examples.json` は翻訳辞書として連携するが、タグカテゴリ編集の入出力対象ではない。
