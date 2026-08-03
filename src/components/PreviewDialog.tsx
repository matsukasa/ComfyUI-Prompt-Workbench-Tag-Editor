import { AlertTriangle, CheckCircle2, Download, X } from "lucide-react";
import type { ChangeSummary, ValidationIssue } from "../domain/types";

interface Props {
  open: boolean;
  fileName: string;
  summary: ChangeSummary;
  issues: ValidationIssue[];
  onClose: () => void;
  onExport: () => void;
}

export function PreviewDialog({ open, fileName, summary, issues, onClose, onExport }: Props) {
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
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる">
            <X />
          </button>
        </header>
        <div className="preview-summary">
          <div>
            <strong>{summary.movedTags}</strong>
            <span>移動</span>
          </div>
          <div>
            <strong>{summary.addedTags}</strong>
            <span>追加</span>
          </div>
          <div>
            <strong>{summary.deletedTags}</strong>
            <span>削除</span>
          </div>
          <div>
            <strong>{summary.renamedTags}</strong>
            <span>名称変更</span>
          </div>
          <div>
            <strong>{summary.changedCategories}</strong>
            <span>カテゴリ変更</span>
          </div>
          <div>
            <strong>
              {summary.duplicateDelta > 0 ? `+${summary.duplicateDelta}` : summary.duplicateDelta}
            </strong>
            <span>重複変化</span>
          </div>
        </div>
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
          <button type="button" onClick={onClose}>
            編集へ戻る
          </button>
          <button className="primary-button" type="button" disabled={errors.length > 0} onClick={onExport}>
            <Download />
            新しいファイルとして書き出す
          </button>
        </footer>
      </section>
    </div>
  );
}
