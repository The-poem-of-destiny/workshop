import { formatBytes } from "./preview";
import { IMAGE_ACCEPT, type PendingImage } from "./usePendingImage";

/** Cover picker: local preview (dimensions + size), explicit upload and clear. */
export function ImagePicker({
  id,
  label,
  hint,
  uploadLabel,
  disabled,
  currentUrl,
  currentAlt,
  pending,
  error,
  onPick,
  onClear,
  onUpload,
}: {
  id: string;
  label: string;
  hint: string;
  uploadLabel: string;
  disabled: boolean;
  currentUrl: string | null;
  currentAlt: string;
  pending: PendingImage | null;
  error: string | null;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="image-picker">
      <div className="image-picker-previews">
        {pending ? (
          <figure className="image-picker-pending">
            <img src={pending.url} alt="待上传预览" />
            <figcaption>
              {pending.file.name} · {pending.width} × {pending.height} · {formatBytes(pending.file.size)}
            </figcaption>
          </figure>
        ) : currentUrl ? (
          <figure className="image-picker-current">
            <img src={currentUrl} alt={currentAlt} />
            <figcaption>当前已上传的图片</figcaption>
          </figure>
        ) : (
          <p className="asset-empty">还没有图片。</p>
        )}
      </div>
      <div className="asset-actions">
        <label className="file-button" htmlFor={id}>
          {pending ? "重新选择图片" : label}
          <input
            id={id}
            type="file"
            accept={IMAGE_ACCEPT}
            disabled={disabled}
            onChange={(event) => {
              onPick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" onClick={onUpload} disabled={disabled || !pending}>
          {uploadLabel}
        </button>
        {pending ? (
          <button type="button" onClick={onClear} disabled={disabled}>
            清除
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="asset-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="field-hint">{hint}</p>
    </div>
  );
}
