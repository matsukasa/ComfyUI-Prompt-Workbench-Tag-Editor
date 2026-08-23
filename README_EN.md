# ComfyUI Prompt Workbench Tag Editor

[日本語](README.md) | [English](README_EN.md)

A local browser app for organising the tag catalogue and tag sets used by `ComfyUI-Prompt-Workbench`.

It works without starting ComfyUI. You can maintain category structures, move tags, rename tags, edit tag sets, manage image metadata, and exchange changes through differential ZIP Import / Export.

Some tag sets bundled with Prompt Workbench include a selection of publicly posted prompts created by [Alice Youfukuten (@AliceLavli)](https://x.com/AliceLavli), included with kind permission. Thank you very much for allowing Prompt Workbench to include them. They are wonderfully expressive and practical references for outfits, mood, and prompt composition, and I am very happy to introduce them as tag sets here.

## Main Features

- Load, validate, edit, and save `tag_catalog.json` and `tag_sets.json`.
- Switch between dedicated tag catalogue editing and tag set editing tabs.
- Add, rename, delete, drag, move, and reorder top-level, middle-level, and subcategories.
- Add, delete, rename, translate, reorder, and move individual tags between subcategories.
- Add, delete, rename, and move tag sets.
- Edit tag set Japanese names, English names, authors, reference URLs, image URLs, image paths, and comma-separated tag contents.
- Mark tag sets as favourites and show only favourites.
- Multi-selection, search, duplicate display, collapsible category trees, and resizable panes.
- Undo / Redo and a save preview that reports changes, errors, and warnings before writing.
- Differential ZIP Export that packages only changes from Factory Default.
- Import shared ZIP files with manifest validation, patch validation, conflict detection, repeated Import detection, and an automatic pre-Import backup.
- Track item origin as `Default`, `Local`, or `Imported`, and avoid reviving Default items that you deleted locally when a later diff is imported.

## Requirements

- Windows 10 / 11
- Node.js 20 or later
- npm 10 or later
- A current browser such as Chrome, Edge, or Vivaldi

Tag data is not sent to an external server. After startup, editing runs in your local browser.

## Start

Double-click `start.bat` from Explorer.

To start from PowerShell:

```powershell
Set-Location 'D:\自作ComfyUIカスタムノード\ComfyUI-Prompt-Workbench-Tag-Editor'
.\start.bat
```

To start the development server manually:

```powershell
npm install --prefer-offline --no-audit --no-fund
npm run dev
```

Open the displayed `http://localhost:5173` URL in your browser.

When opened through a LAN URL such as `http://192.168.x.x:5173`, the browser may not treat the page as a secure local context, and overwrite-save APIs may be unavailable. Use `http://localhost:5173` on the same PC when you want overwrite save.

## Basic Usage

1. Use `Open settings file` at the top to open `tag_catalog.json` or `tag_sets.json`.
2. Switch between the tag editing and tag set editing tabs.
3. Edit the data.
4. Use `Overwrite` or `Save As` to save.
5. Check the save preview for change counts, warnings, and errors before saving.

### Tag Editing

- Select a middle-level category in the left category tree to show tags grouped by subcategory.
- Drag tags to reorder them within the same subcategory or move them to another subcategory.
- Double-click an English tag name or Japanese name to edit it inline.
- Move or delete multiple selected tags together.
- Edit, move, or delete top-level, middle-level, and subcategories from the tree.
- Search by English tags, Japanese names, and category names.
- Review duplicate candidates and save-time validation messages before writing.

### Tag Set Editing

- Open the `Tag set editing` tab to edit `tag_sets.json`.
- Add, rename, move, and delete tag set categories.
- Edit the tag set name, Japanese name, English name, author, reference URL, image URL, image path, and tag contents.
- Move tag sets to another subcategory.
- Mark tag sets as favourites and filter to favourites.
- Edit comma-separated tags in the tag input field; they are saved as the tag array in each `sets` entry.
- Keep source metadata such as `creator` and `source_url`, so contributed tag sets remain attributable while you reorganise them.

## Differential Import / Export

Import / Export is available from the gear menu in the top-right.

### Export Diff

`Export diff` compares Factory Default with the current edited state and packages only the difference into a ZIP file. If Factory Default cannot be loaded, the loaded state is used as the comparison base.

Export targets are:

- Export tag catalogue only
- Export tag sets only
- Export both

The ZIP file name uses this format:

```text
PromptWorkbench_<PackageName>_<Catalog|TagSets|Full>_v<PackageVersion>_<YYYYMMDD>_<HHMM>.zip
```

The ZIP contains:

- `manifest.json`
- `catalog_patch.json` when the tag catalogue is included
- `tagset_patch.json` when tag sets are included
- `changes.csv`

`changes.csv` is for human review and is not used by Import.

### Import Shared Package

`Import shared package` reads `manifest.json` as the authoritative package metadata. Renaming the ZIP file does not change package information.

Import shows a preview before applying anything:

- Manifest check
- Patch check
- Import target selection
- Conflict check
- Change counts
- Error messages
- Progress phases

If a ZIP contains both the catalogue and tag sets, you can choose which parts to import. Parts that are not included in the ZIP cannot be selected.

When there are no blocking issues, `Apply Import` updates the current in-memory editing state. It does not overwrite the source files until you save.

Before applying an Import, the current `tag_catalog.json` and `tag_sets.json` are exported automatically as `PromptWorkbench_before_import_<YYYYMMDD>.zip`. If application fails, the editor restores the in-memory state from before the Import and reports the failed phase and cause.

### Repeated Import Detection

Imported `package_id + package_version` values are recorded in browser `localStorage`.

Trying to import the same `package_id + package_version` again shows a preview error and disables applying the Import.

### Conflict Detection

The editor compares the before-change data from the exported package with the current data at the Import destination.

If a tag, tag category, tag set, or tag set category with the same ID has already been changed differently at the destination, it is reported as a conflict and Import stops.

When conflicts exist, you can keep the current settings and stop, apply the Import-side data for conflicting entries, or skip only the conflicting entries for this Import. Older ZIP files without before-change data can only be checked within the available information.

### Delete Handling

Shared diffs do not include delete operations.

Export omits:

- Tag deletion
- Tag catalogue category deletion
- Tag set deletion
- Tag set category deletion

If an old ZIP contains delete operations, Import ignores them. Default-origin items that you deleted locally are recorded in `prompt_workbench_meta`, so importing a later package that still contains those Default items does not revive them.

### New Categories

Top-level, middle-level, and subcategories added by another user are imported for both:

- Tag catalogue categories
- Tag set categories

### Default / Local / Imported

Tags, tag catalogue categories, tag set categories, and tag sets keep origin metadata.

- `Default`: bundled initial data
- `Local`: data added locally
- `Imported`: data added or updated through Import

Hover over a row to inspect its origin. Saved JSON keeps origin metadata, deleted Default items, and Import history in `prompt_workbench_meta`.

## Saving

In browsers that support the File System Access API, such as Chrome and Edge, the editor can keep the opened file handle and overwrite the file.

If the file was not opened directly, or if the browser does not support overwrite save, use Save As or browser download save.

When there are errors, save buttons are disabled. Warnings still allow saving after review.

## Supported Formats

### Tag Catalogue

- Bundled format: JSON with `schema_version` and `major_categories`
- User format: JSON with `schema: "prompt-workbench/tag-catalog"`, `version: 1`, `categories`, and `tags`

### Tag Sets

- `schema_version: 1`
- `major_categories`
- `medium_categories`
- `small_categories`
- `sets`

YAML, CSV, JavaScript, and commented JSON are not supported.

## Known Limitations

- General compressed ZIP files are not supported. Use the uncompressed ZIP files exported by this app.
- Import does not create a physical backup beside the source files. It exports a backup ZIP before applying Import and does not overwrite the source files until you save.
- Automatic conflict merging and per-conflict manual resolution are not supported yet.
- `base_catalog_version` and `base_tagset_version` are derived from comparison-base metadata such as `generated_at`, `version`, and item counts.
- Browsers cannot always reveal the absolute path of the original file.
- JSON comments and duplicate property names cannot be preserved because they are not standard JSON data.

## Build

```powershell
npm run build
```

The production build is generated under `dist/client`. `dist/server/index.js` and `dist/.openai/hosting.json` are also generated for Sites.

## Test

```powershell
npm run test:sites
```

The current test checks static serving through the Sites worker. Browser drag operations, manual ZIP round trips, and ComfyUI runtime behaviour should be checked separately.

## Troubleshooting

- `npm` is not found: install Node.js 20 or later, then retry in a new terminal.
- JSON cannot be loaded: check the extension, encoding, trailing commas, quotes, and root schema.
- Overwrite save is unavailable: reopen through `http://localhost:5173` and use a browser that supports the File System Access API.
- Import cannot be applied: check preview errors, conflicts, and repeated Import detection messages.
- A compressed ZIP cannot be loaded: use a ZIP exported by this app.
