import { useEffect, useState } from "react";
import { api } from "../../../api";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { ImagePicker } from "./ImagePicker";
import { usePendingImage } from "./usePendingImage";

function useGallerySlotPreview(remotePath: string | null, nonce: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void nonce;
    if (!remotePath) {
      setUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    api
      .galleryImage(remotePath)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [remotePath, nonce]);
  return url;
}

export function GallerySection({
  projectId,
  rowVersion,
  busy,
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
  setBusy: (busy: boolean) => void;
  onRowVersionChange: (version: number) => void;
  onRefresh: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onPendingChange?: (hasPending: boolean) => void;
}) {
  const [remoteSlots, setRemoteSlots] = useState<Record<number, string>>({});
  const [nonce, setNonce] = useState(0);
  const [deleteSlot, setDeleteSlot] = useState<number | null>(null);
  const slot0 = usePendingImage();
  const slot1 = usePendingImage();
  const hasPending = Boolean(slot0.pending || slot1.pending);

  useEffect(() => {
    onPendingChange?.(hasPending);
    return () => onPendingChange?.(false);
  }, [hasPending, onPendingChange]);

  useEffect(() => {
    let active = true;
    void nonce;
    api
      .projectGallery(projectId)
      .then((res) => {
        if (!active) return;
        const next: Record<number, string> = {};
        for (const item of res.images) next[item.slot] = item.url;
        setRemoteSlots(next);
      })
      .catch(() => {
        if (active) setRemoteSlots({});
      });
    return () => {
      active = false;
    };
  }, [projectId, nonce]);

  const url0 = useGallerySlotPreview(remoteSlots[0] ?? null, nonce);
  const url1 = useGallerySlotPreview(remoteSlots[1] ?? null, nonce);

  async function uploadSlot(slot: 0 | 1): Promise<void> {
    const picker = slot === 0 ? slot0 : slot1;
    if (!picker.pending || busy) return;
    setBusy(true);
    try {
      const result = await api.uploadGalleryImage(projectId, slot, rowVersion, picker.pending.file);
      onRowVersionChange(result.rowVersion);
      picker.clear();
      setNonce((value) => value + 1);
      onNotice(`展示图 ${slot + 1} 已上传。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteSlot(): Promise<void> {
    if (deleteSlot === null || busy) return;
    const slot = deleteSlot;
    setBusy(true);
    try {
      const result = await api.deleteGalleryImage(projectId, slot, rowVersion);
      onRowVersionChange(result.rowVersion);
      setDeleteSlot(null);
      setNonce((value) => value + 1);
      onNotice(`展示图 ${slot + 1} 已移除。`);
      await onRefresh();
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section authoring-section">
      <h3>详情展示图（可选，最多 2 张）</h3>
      <p className="workspace-muted">展示在作品详情页轮播区，支持 JPEG、PNG 或 WebP，单张不超过 1 MiB。</p>
      <div className="gallery-picker-grid">
        {([0, 1] as const).map((slot) => {
          const picker = slot === 0 ? slot0 : slot1;
          const currentUrl = slot === 0 ? url0 : url1;
          const hasRemote = Boolean(remoteSlots[slot]);
          return (
            <div key={slot} className="gallery-slot-card">
              <div className="gallery-slot-head">
                <strong>展示图 {slot + 1}</strong>
                {hasRemote && !picker.pending ? (
                  <button type="button" className="link-danger" disabled={busy} onClick={() => setDeleteSlot(slot)}>
                    移除当前图片
                  </button>
                ) : null}
              </div>
              <ImagePicker
                id={`gallery-file-${slot}`}
                label={`选择展示图 ${slot + 1}`}
                uploadLabel={hasRemote ? `替换展示图 ${slot + 1}` : `上传展示图 ${slot + 1}`}
                hint="选择后可先预览尺寸，点击上传后立即保存。"
                disabled={busy}
                currentUrl={currentUrl}
                currentAlt={`当前展示图 ${slot + 1}`}
                pending={picker.pending}
                error={picker.error}
                onPick={(file) => void picker.pick(file)}
                onClear={picker.clear}
                onUpload={() => void uploadSlot(slot)}
              />
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={deleteSlot !== null}
        title="移除展示图"
        description={deleteSlot !== null ? `确定移除展示图 ${deleteSlot + 1} 吗？` : undefined}
        confirmLabel="确认移除"
        danger
        busy={busy}
        onConfirm={() => void confirmDeleteSlot()}
        onCancel={() => setDeleteSlot(null)}
      />
    </section>
  );
}
