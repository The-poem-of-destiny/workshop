import { useState } from "react";
import { keyedItems } from "../../../lib/keyedItems";
import { fileKey, formatBytes, type RegexAsset, type WorldbookAsset } from "./preview";

function Dropzone({
  id,
  label,
  hint,
  accept,
  multiple = false,
  disabled,
  onFiles,
}: {
  id: string;
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled: boolean;
  onFiles: (files: FileList) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <section
      className={`asset-dropzone${active ? " is-active" : ""}`}
      aria-labelledby={`${id}-label`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setActive(false);
        if (!disabled && event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
      }}
    >
      <label className="file-button" id={`${id}-label`} htmlFor={id}>
        {label}
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) onFiles(files);
            event.target.value = "";
          }}
        />
      </label>
      <span className="asset-dropzone-hint">{hint}</span>
    </section>
  );
}

/** Pick, preview and confirm upload for worldbook and regex files. Uploads only happen on the explicit buttons. */
export function AssetPicker({
  worldbook,
  regexAssets,
  worldbookError,
  regexError,
  worldbookUploaded,
  regexUploaded,
  busy,
  onPickWorldbook,
  onPickRegex,
  onRemoveWorldbook,
  onRemoveRegex,
  onUploadWorldbook,
  onUploadRegex,
}: {
  worldbook: WorldbookAsset | null;
  regexAssets: readonly RegexAsset[];
  worldbookError: string | null;
  regexError: string | null;
  worldbookUploaded: boolean;
  regexUploaded: boolean;
  busy: boolean;
  onPickWorldbook: (files: FileList) => void;
  onPickRegex: (files: FileList) => void;
  onRemoveWorldbook: () => void;
  onRemoveRegex: (index: number) => void;
  onUploadWorldbook: () => void;
  onUploadRegex: () => void;
}) {
  const regexCount = regexAssets.reduce((total, asset) => total + asset.entries.length, 0);
  return (
    <section className="asset-picker">
      <p className="field-hint">
        至少上传一份有效的世界书或正则 JSON（世界书条目会自动添加 [工坊] 前缀，选择文件后可先预览并执行本地预检）。
      </p>
      <div className="asset-grid">
        <div className="asset-card">
          <div className="asset-card-heading">
            <strong>世界书</strong>
            <span>单个 JSON 文件</span>
          </div>
          <Dropzone
            id="worldbook-file"
            label="选择世界书 JSON"
            hint="也可以把文件拖到这里"
            accept=".json,application/json,text/plain"
            disabled={busy}
            onFiles={onPickWorldbook}
          />
          {worldbookError ? (
            <p className="asset-error" role="alert">
              {worldbookError}
            </p>
          ) : null}
          {worldbook ? (
            <div className="asset-preview">
              <div className="asset-file-chip">
                <span title={worldbook.file.name}>{worldbook.file.name}</span>
                <b>{worldbook.entries.length} 条</b>
                <span>{formatBytes(worldbook.file.size)}</span>
                <button
                  type="button"
                  aria-label={`清除 ${worldbook.file.name}`}
                  title="清除"
                  disabled={busy}
                  onClick={onRemoveWorldbook}
                >
                  ×
                </button>
              </div>
              {worldbookUploaded ? <p className="asset-uploaded">已上传到当前版本。</p> : null}
              {worldbook.entries.length === 0 ? (
                <p className="asset-error" role="alert">
                  没有识别到条目，请检查 JSON 结构。
                </p>
              ) : (
                <ul className="asset-entry-list">
                  {keyedItems(worldbook.entries).map(({ item: entry, key }) => (
                    <li className="asset-entry" key={key}>
                      <div className="asset-entry-title">
                        <strong>{entry.name}</strong>
                        <span className={`asset-badge${entry.enabled ? "" : " is-off"}`}>
                          {entry.enabled ? "启用" : "停用"}
                        </span>
                        {entry.hasEjs ? <span className="asset-badge">含 EJS</span> : null}
                      </div>
                      <small>
                        关键词：{entry.keys.length > 0 ? entry.keys.join("、") : "无"} · 位置：{entry.position} · 顺序{" "}
                        {entry.order} · 深度 {entry.depth} · {entry.contentChars} 字
                      </small>
                      {entry.secondaryKeys.length > 0 ? (
                        <small>次关键词：{entry.secondaryKeys.join("、")}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="asset-empty">还没有选择世界书。</p>
          )}
          <div className="asset-actions">
            <button type="button" onClick={onUploadWorldbook} disabled={busy || !worldbook}>
              {worldbookUploaded ? "重新上传世界书" : "上传世界书"}
            </button>
          </div>
        </div>
        <div className="asset-card">
          <div className="asset-card-heading">
            <strong>正则</strong>
            <span>可一次选择多个 JSON 文件</span>
          </div>
          <Dropzone
            id="regex-file"
            label="选择正则 JSON"
            hint="也可以把多个文件拖到这里"
            accept=".json,application/json,text/plain"
            multiple
            disabled={busy}
            onFiles={onPickRegex}
          />
          {regexError ? (
            <p className="asset-error" role="alert">
              {regexError}
            </p>
          ) : null}
          {regexAssets.length > 0 ? (
            <div className="asset-preview">
              <div className="asset-chip-row">
                {regexAssets.map((asset, index) => (
                  <span className="asset-file-chip" key={fileKey(asset.file)}>
                    <span title={asset.file.name}>{asset.file.name}</span>
                    <b>{asset.entries.length} 条</b>
                    <button
                      type="button"
                      aria-label={`移除 ${asset.file.name}`}
                      title="移除"
                      disabled={busy}
                      onClick={() => onRemoveRegex(index)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <p className="field-hint">
                合计 {regexCount} 条正则
                {regexAssets.length > 1 ? `；上传时会合并成一份 JSON 数组。` : "。"}
              </p>
              {regexUploaded ? <p className="asset-uploaded">已上传到当前版本。</p> : null}
              {regexAssets.map((asset) => (
                <details className="asset-regex-file" key={`file-${fileKey(asset.file)}`}>
                  <summary>
                    {asset.file.name} · {asset.entries.length} 条
                  </summary>
                  <ul className="asset-entry-list">
                    {keyedItems(asset.entries).map(({ item: entry, key }) => (
                      <li className="asset-entry" key={key}>
                        <div className="asset-entry-title">
                          <strong>{entry.scriptName}</strong>
                          {entry.disabled ? <span className="asset-badge is-off">停用</span> : null}
                        </div>
                        <small>匹配规则：{entry.findRegex}</small>
                        <small>替换内容 {entry.replaceChars} 字</small>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          ) : (
            <p className="asset-empty">还没有选择正则文件。</p>
          )}
          <div className="asset-actions">
            <button type="button" onClick={onUploadRegex} disabled={busy || regexAssets.length === 0}>
              {regexUploaded ? "重新上传正则" : "上传正则"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
