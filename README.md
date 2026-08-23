# ComfyUI Prompt Workbench Tag Editor

[日本語](README.md) | [English](README_EN.md)

`ComfyUI-Prompt-Workbench` のタグカタログとタグセットを、ブラウザで整理するローカルWebアプリです。

ComfyUI本体を起動していなくても使えます。タグカタログの分類整理、タグ移動、タグ名編集、タグセット編集、画像メタデータ編集、差分ZIPのImport / Exportに対応しています。
Prompt Workbenchに同梱されるタグセットには、[アリス服飾店（@AliceLavli）様](https://x.com/AliceLavli) が公開されているプロンプトの一部を、ご厚意により収録させていただいています。使用を快く許可してくださり、本当にありがとうございます。どのプロンプトも雰囲気づくりや衣装表現の参考になる素敵なものばかりで、こうしてタグセットとして使わせていただけることを、とてもありがたく思っています。この場を借りて、心よりお礼申し上げます。

## 主な機能

- `tag_catalog.json` と `tag_sets.json` の読み込み、スキーマ検証、編集、保存
- タグカタログとタグセットをタブで切り替える2系統編集
- 大分類・中分類・小分類の追加、名称編集、削除、ドラッグ移動、並べ替え
- タグの追加、削除、英語名編集、日本語名編集、別小分類への移動
- タグセットの追加、削除、名称編集、日本語名、英語名、作者、参照URL、画像URL、画像パス、タグ内容の編集
- タグセットの別小分類への移動、お気に入り登録、お気に入りだけの表示
- 複数選択、検索、重複表示、分類ツリーの折りたたみ、ペイン幅調整
- Undo / Redo と保存前preview
- Factory Defaultとの差分だけを書き出す差分ZIP Export
- 共有ZIPのmanifest検証、patch検証、競合検出、再Import検出、適用前backup付きImport
- `Default`、`Local`、`Imported` の由来表示と、削除済みDefault項目の再Import復活防止

## 必要環境

- Windows 10 / 11
- Node.js 20以上
- npm 10以上
- Chrome、Edge、Vivaldiなどの現行ブラウザ

タグデータは外部サーバーへ送信しません。起動後はローカルブラウザ内で動作します。

## 起動

エクスプローラーから `start.bat` をダブルクリックします。

PowerShellから起動する場合:

```powershell
Set-Location 'D:\自作ComfyUIカスタムノード\ComfyUI-Prompt-Workbench-Tag-Editor'
.\start.bat
```

手動で開発サーバーを起動する場合:

```powershell
npm install --prefer-offline --no-audit --no-fund
npm run dev
```

表示された `http://localhost:5173` をブラウザで開きます。

`http://192.168.x.x:5173` のようなLAN側URLでは、ブラウザの安全な接続として扱われず、ファイルの上書き保存APIを利用できない場合があります。上書き保存する場合は、起動したPC上のブラウザで `http://localhost:5173` を使ってください。

## 基本操作

1. 上部の「設定ファイルを開く」から `tag_catalog.json` または `tag_sets.json` を開きます。
2. 「タグ編集」と「タグセット編集」タブを切り替えて編集します。
3. 編集後、「上書き保存」または「別名で保存」で保存します。
4. 保存前previewで変更件数とエラーを確認します。

### タグ編集

- 左の分類ツリーから中分類を選ぶと、小分類ごとのタグ一覧が表示されます。
- タグはドラッグで同じ小分類内の並べ替え、または別の小分類へ移動できます。
- タグ名または日本語名をダブルクリックすると直接編集できます。
- 複数選択したタグはまとめて移動、削除できます。
- 大分類・中分類・小分類はツリー上で編集、移動、削除できます。
- 検索で英語タグ、日本語名、分類名を絞り込めます。
- 重複候補を表示し、保存前previewでエラーや警告を確認できます。

### タグセット編集

- 「タグセット編集」タブで `tag_sets.json` を編集します。
- タグセット分類の追加、名称編集、移動、削除に対応します。
- タグセット本体の名称、日本語名、英語名、作者、参照URL、画像URL、画像パス、タグ内容を編集できます。
- タグセットは別の小分類へ移動できます。
- お気に入り登録とお気に入り表示に対応します。
- タグ入力欄ではカンマ区切りのタグを編集でき、保存時は `sets` のタグ配列として保持します。
- `creator` や `source_url` を残せるため、アリス服飾店様のような出典つきタグセットも出典情報を保ったまま整理できます。

## 差分Import / Export

Import / Exportは、右上の歯車アイコンの設定メニュー内にあります。

### 差分を書き出す

「差分を書き出す」では、Factory Default と現在の編集状態を比較し、差分だけをZIPにまとめます。Factory Default を読み込めなかった場合だけ、読み込み時の状態を比較元にします。

書き出し対象は次から選べます。

- タグカタログのみ書き出し
- タグセットのみ書き出し
- 両方書き出し

ZIP名は次の形式です。

```text
PromptWorkbench_<PackageName>_<Catalog|TagSets|Full>_v<PackageVersion>_<YYYYMMDD>_<HHMM>.zip
```

ZIPには次のファイルが入ります。

- `manifest.json`
- `catalog_patch.json`（タグカタログを含む場合）
- `tagset_patch.json`（タグセットを含む場合）
- `changes.csv`

`changes.csv` は人が内容を確認するためのファイルです。Import処理には使いません。

Export previewには、書き出し予定のカタログ操作数、タグセット操作数、削除操作を含めないことを表示します。

### 共有パッケージを読み込む

「共有パッケージを読み込む」では、ZIP内の `manifest.json` を正として読み込みます。ZIPファイル名を変更しても、package情報はZIP名から推測しません。

Import時はすぐに適用せず、previewを表示します。

- manifest確認
- patch確認
- Import対象の選択
- 競合確認
- 変更件数表示
- エラー表示
- 進捗フェーズ表示

ZIPにタグカタログとタグセットの両方が入っている場合でも、Import画面でどちらを読み込むか選べます。ZIPに含まれていない対象は選択できません。

問題がなければ「Importを適用」で現在の編集状態へ反映します。適用後も元ファイルは上書きされません。保存するまでは未保存の編集状態です。

Import適用前には、現在の `tag_catalog.json` と `tag_sets.json` を `PromptWorkbench_before_import_<YYYYMMDD>.zip` として自動で書き出します。適用中にエラーが起きた場合は、画面上の編集状態を適用前に戻し、取り消し、復元、整合性確認の進捗と、失敗した処理段階・原因を表示します。

「Importを適用」ボタンが無効な場合は、ボタンの上とツールチップに理由を表示します。たとえば、ZIP未選択、確認エラー、対象未選択、競合を停止設定にしている場合です。

### 再Import検出

Import済みの `package_id + package_version` はブラウザの `localStorage` に記録します。

同じ `package_id + package_version` のZIPを再度Importしようとすると、previewでエラーとして表示し、適用できないようにします。

### 競合検出

Export時の変更前データと、Import先の現在データを比較します。

同じIDのタグ、タグ分類、タグセット、タグセット分類がImport先で既に別内容へ変更されている場合は競合として表示し、Importを停止します。

競合がある場合は、現在の設定を保持して停止するか、競合箇所はImport側を採用するか、競合箇所だけ今回スキップするかを選べます。Import側を採用すると、同じIDの既存内容はImport内容で更新されます。スキップを選ぶと、競合していない差分だけをImportします。

旧形式のZIPなど、変更前データが含まれていないpatchでは検出できる範囲が限られます。

### 削除の扱い

共有差分では、削除操作は共有しません。

Exportでは次の削除操作をZIPに含めません。

- タグ削除
- タグカタログ分類削除
- タグセット削除
- タグセット分類削除

古いZIPに削除operationが含まれていても、Import側では削除を無視します。他のユーザーの削除によって、自分のローカルデータが消えることを避けるためです。

自分が削除したDefault由来のタグ、タグ分類、タグセット、タグセット分類は `prompt_workbench_meta` に記録します。そのため、後から同じDefault項目を含む差分ZIPをImportしても、削除済みのDefault項目は復活しません。

### 新規分類の扱い

他のユーザーが追加した大分類・中分類・小分類は、Importで追加されます。

対象は次の両方です。

- タグカタログの大分類・中分類・小分類
- タグセットの大分類・中分類・小分類

### Default / Local / Imported の区別

タグ、タグカタログ分類、タグセット分類、タグセットには由来を持たせます。

- `Default`: 初期データ由来
- `Local`: 自分で追加したデータ
- `Imported`: Importで追加または更新されたデータ

画面上では、行にマウスを置くと由来を確認できます。保存されるJSONでは `prompt_workbench_meta` に由来、削除済みDefault項目、Import履歴を保持します。
Import画面には、保存済みのImport履歴も表示します。

## 保存

Chrome、EdgeなどFile System Access API対応ブラウザでは、開いたファイルハンドルを保持して上書き保存できます。

`tag_catalog.json` など既定ファイルを直接開いていない場合や、ブラウザが上書き保存APIに対応していない場合は、別名保存またはダウンロード保存になります。

保存前にエラーがある場合、保存ボタンは無効になります。警告だけの場合は、内容を確認したうえで保存できます。

## 対応形式

### タグカタログ

- 同梱形式: `schema_version` と `major_categories` を持つJSON
- ユーザー形式: `schema: "prompt-workbench/tag-catalog"`、`version: 1`、`categories`、`tags` を持つJSON

### タグセット

- `schema_version: 1`
- `major_categories`
- `medium_categories`
- `small_categories`
- `sets`

JSON以外のYAML、CSV、JavaScript、コメント付きJSONには対応していません。

## 既知の制限

- 一般的な圧縮ZIPの読み込みには対応していません。このアプリが書き出す無圧縮ZIPを読み込んでください。
- Import前の物理バックアップファイル作成はまだ行いません。Import適用後も保存するまでは元ファイルを上書きしない設計です。
- 競合の自動マージや、競合ごとの個別選択解決にはまだ対応していません。
- `base_catalog_version` / `base_tagset_version` は、比較元データの `generated_at`、`version`、件数などから設定します。
- ブラウザは元ファイルの絶対パスを常に取得できるわけではありません。
- JSONのコメントや重複プロパティ名は標準JSONとして表現できないため維持できません。

## ビルド

```powershell
npm run build
```

本番ビルドは `dist/client` に生成されます。Sites用の `dist/server/index.js` と `dist/.openai/hosting.json` も生成されます。

## テスト

```powershell
npm run test:sites
```

現在のテストはSites workerの静的配信確認です。ブラウザ上のドラッグ操作、ZIPの手動往復確認、ComfyUI実行環境での動作確認は別途確認してください。

## トラブルシューティング

- `npm` が見つからない: Node.js 20以上をインストールし、新しいターミナルで再実行してください。
- JSONを読み込めない: 拡張子、文字コード、末尾カンマ、引用符、ルートスキーマを確認してください。
- 上書き保存できない: `http://localhost:5173` で開き直し、File System Access API対応ブラウザを使ってください。
- Importできない: previewのエラー、競合、再Import検出メッセージを確認してください。
- 圧縮ZIPを読み込めない: このアプリから書き出したZIPを使ってください。
