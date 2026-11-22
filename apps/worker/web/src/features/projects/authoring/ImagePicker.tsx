import { ImageIcon, Move, RotateCcw } from "lucide-react";
import { type PointerEvent, useRef } from "react";
import { formatBytes } from "./preview";
import { IMAGE_ACCEPT, type PendingImage } from "./usePendingImage";

export interface CoverCropState {
  posX: number;
  posY: number;
  zoom: number;
  onChange: (next: { posX: number; posY: number; zoom: number }) => void;
}

/** Cover & gallery picker: supports live 16:9 drag-to-crop + zoom preview when `crop` is provided. */
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
  crop,
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
  crop?: CoverCropState;
  onPick: (file: File | undefined) => void;
  onClear: () => void;
  onUpload: () => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const displayUrl = pending?.url ?? currentUrl;

  function beginDrag(event: PointerEvent<HTMLElement>): void {
    if (!crop || disabled || !displayUrl) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: crop.posX,
      originY: crop.posY,
    };
  }

  function moveDrag(event: PointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag || !crop || disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const sensitivity = 100 / Math.max(1, crop.zoom * 0.85);
    const nextX = Math.round(
      Math.max(0, Math.min(100, drag.originX - ((event.clientX - drag.startX) / rect.width) * sensitivity)),
    );
    const nextY = Math.round(
      Math.max(0, Math.min(100, drag.originY - ((event.clientY - drag.startY) / rect.height) * sensitivity)),
    );
    crop.onChange({ posX: nextX, posY: nextY, zoom: crop.zoom });
  }

  function endDrag(): void {
    dragRef.current = null;
  }

  return (
    <div className={`image-picker${crop ? " image-picker-cover" : ""}`}>
      <div className="image-picker-previews">
        {displayUrl ? (
          <figure className={pending ? "image-picker-pending" : "image-picker-current"}>
            <div
              className={`image-picker-frame${crop && !disabled ? " is-draggable" : ""}`}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <img
                src={displayUrl}
                alt={pending ? "待上传预览" : currentAlt}
                draggable={false}
                style={
                  crop
                    ? {
                        objectPosition: `${crop.posX}% ${crop.posY}%`,
                        transform: `scale(${crop.zoom})`,
                      }
                    : undefined
                }
              />
              {crop && !disabled ? (
                <span className="crop-drag-badge" aria-hidden="true">
                  <Move />
                  拖拽调整焦点
                </span>
              ) : null}
            </div>
            <figcaption>
              {pending
                ? `待上传：${pending.file.name}（${pending.width}×${pending.height} · ${formatBytes(pending.file.size)}）`
                : "当前已保存图片"}
            </figcaption>
          </figure>
        ) : (
          <div className="image-picker-empty">
            <ImageIcon aria-hidden="true" />
            <span>暂未上传图片</span>
          </div>
        )}
      </div>

      {crop && displayUrl ? (
        <div className="cover-crop-controls">
          <label className="cover-zoom-slider">
            <span>画面缩放 {crop.zoom.toFixed(2)}×</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={crop.zoom}
              disabled={disabled}
              onChange={(event) =>
                crop.onChange({ posX: crop.posX, posY: crop.posY, zoom: Number(event.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className="crop-reset-btn"
            disabled={disabled || (crop.posX === 50 && crop.posY === 50 && crop.zoom === 1)}
            onClick={() => crop.onChange({ posX: 50, posY: 50, zoom: 1 })}
          >
            <RotateCcw aria-hidden="true" />
            居中重置
          </button>
        </div>
      ) : null}

      <div className="asset-actions">
        <label className="file-button" htmlFor={id}>
          {pending ? "重新选择" : label}
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
        <button
          type="button"
          className={pending ? "workspace-primary" : undefined}
          onClick={onUpload}
          disabled={disabled || !pending}
        >
          {uploadLabel}
        </button>
        {pending ? (
          <button type="button" onClick={onClear} disabled={disabled}>
            取消选择
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
