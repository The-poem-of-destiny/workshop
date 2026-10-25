import { useEffect, useRef, useState } from "react";

export type PendingImage = { file: File; url: string; width: number; height: number };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 4096;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Checks MIME type, byte size and decoded dimensions without keeping the bitmap. */
export async function readImageInfo(
  file: File,
): Promise<{ ok: true; width: number; height: number } | { ok: false; error: string }> {
  if (!IMAGE_TYPES.has(file.type)) return { ok: false, error: "图片必须是 JPEG、PNG 或 WebP。" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "图片不能超过 5 MiB。" };
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close();
    if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
      return { ok: false, error: "图片的宽高都不能超过 4096 像素。" };
    }
    return { ok: true, width, height };
  } catch {
    return { ok: false, error: "无法读取这张图片，请选择有效的 JPEG、PNG 或 WebP 文件。" };
  }
}

/** Validates a locally picked image and keeps an object URL preview until uploaded or cleared. */
export function usePendingImage(): {
  pending: PendingImage | null;
  error: string | null;
  pick: (file: File | undefined) => Promise<void>;
  clear: () => void;
} {
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const pickVersion = useRef(0);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function pick(file: File | undefined): Promise<void> {
    if (!file) return;
    const version = pickVersion.current + 1;
    pickVersion.current = version;
    const info = await readImageInfo(file);
    if (version !== pickVersion.current) return;
    if (!info.ok) {
      setError(info.error);
      return;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setError(null);
    setPending({ file, url, width: info.width, height: info.height });
  }

  function clear(): void {
    pickVersion.current += 1;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPending(null);
    setError(null);
  }

  return { pending, error, pick, clear };
}
