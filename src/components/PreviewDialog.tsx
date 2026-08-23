import { AlertTriangle, CheckCircle2, Download, Save, X } from "lucide-react";
import type { ChangeSummary, ValidationIssue } from "../domain/types";

interface Props {
  open: boolean;
  mode: "overwrite" | "saveAs";
  fileName: string;
  targetPath?: string;
  summary?: ChangeSummary;
  issues: ValidationIssue[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}

export function PreviewDialog({ open, mode, fileName, targetPath, summary, issues, saving, onClose, onSave }: Props) {
  if (!open) return null;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="preview-title">変更プレビュー</h2>
            <p>{fileName}</p>
            {mode === "overwrite" && targetPath && (
              <p className="preview-target-path" title={targetPath}>
                上書き先: {targetPath}
              </p>
            )}
            <p className="safe-export-note">
              {mode === "overwrite"
                ? "確認後、現在のファイルを上書き保存します。"
                : "OSの保存場所選択画面を開き、上記の候補名で保存します。"}
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X />
          </button>
        </header>
        <div className="validation-panel">
          <h3>エクスポート前の検証</h3>
          {errors.length === 0 && (
            <p className="validation-ok">
              <CheckCircle2 />
              重大なエラーはありません
            </p>
          )}
          {errors.map((issue) => (
            <p className="validation-error" key={`${issue.code}:${issue.targetId ?? issue.message}`}>
              <AlertTriangle />
              {issue.message}
            </p>
          ))}
          {warnings.slice(0, 8).map((issue) => (
            <p className="validation-warning" key={`${issue.code}:${issue.message}`}>
              <AlertTriangle />
              {issue.message}
            </p>
          ))}
          {warnings.length > 8 && <p>ほか {warnings.length - 8} 件の警告があります。</p>}
        </div>
        <footer>
          <button type="button" disabled={saving} onClick={onClose}>
            編集へ戻る
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={errors.length > 0 || saving}
            onClick={onSave}
          >
            {mode === "overwrite" ? <Save /> : <Download />}
            {saving ? "保存中…" : mode === "overwrite" ? "上書き保存" : "別名で保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}
