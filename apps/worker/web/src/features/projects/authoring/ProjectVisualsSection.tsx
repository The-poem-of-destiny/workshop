import { GallerySection } from "./GallerySection";
import { ImagePicker } from "./ImagePicker";
import type { usePendingImage } from "./usePendingImage";

export function ProjectVisualsSection({
  projectId,
  rowVersion,
  busy,
  frozen,
  coverUrl,
  cover,
  posX,
  posY,
  zoom,
  onCropChange,
  onUploadCover,
  setBusy,
  onRowVersionChange,
  onRefresh,
  onNotice,
  onError,
  onPendingChange,
}: {
  projectId: string;
  rowVersion: number;
  busy: boolean;
  frozen: boolean;
  coverUrl: string | null;
  cover: ReturnType<typeof usePendingImage>;
  posX: number;
  posY: number;
  zoom: number;
  onCropChange: (next: { posX: number; posY: number; zoom: number }) => void;
  onUploadCover: () => void;
  setBusy: (busy: boolean) => void;
  onRowVersionChange: (version: number) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onPendingChange: (hasPending: boolean) => void;
}) {
  return (
    <section id="editor-sec-visuals" className="workspace-section authoring-section authoring-card">
      <h3>② 封面构图与详情展示图</h3>
      <div className="editor-visuals-grid">
        <div className="editor-cover-column">
          <h4>作品卡片封面（16:9 实时裁切预览）</h4>
          <ImagePicker
            id="cover-file"
            label="选择封面"
            uploadLabel={coverUrl ? "更新封面" : "上传封面"}
            hint="支持 JPEG / PNG / WebP（≤1 MiB，宽高 ≤4096px）。拖拽上方画面调整构图后记得点击底部「保存草稿资料」。"
            disabled={busy || frozen}
            currentUrl={coverUrl}
            currentAlt="当前封面"
            pending={cover.pending}
            error={cover.error}
            crop={{
              posX,
              posY,
              zoom,
              onChange: onCropChange,
            }}
            onPick={(file) => void cover.pick(file)}
            onClear={cover.clear}
            onUpload={onUploadCover}
          />
        </div>
        <div className="editor-gallery-column">
          <GallerySection
            projectId={projectId}
            rowVersion={rowVersion}
            busy={busy}
            setBusy={setBusy}
            onRowVersionChange={onRowVersionChange}
            onRefresh={onRefresh}
            onNotice={onNotice}
            onError={onError}
            onPendingChange={onPendingChange}
          />
        </div>
      </div>
    </section>
  );
}
