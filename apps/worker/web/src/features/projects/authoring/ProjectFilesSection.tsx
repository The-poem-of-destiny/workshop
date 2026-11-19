import { AssetPicker } from "./AssetPicker";
import { CheckPanel } from "./CheckPanel";
import { CurrentVersionEntries } from "./CurrentVersionEntries";
import type { runLocalCheck } from "./checker";
import type { useDraftAssetSelection } from "./useDraftAssetSelection";

export function ProjectFilesSection({
  projectId,
  versionId,
  rowVersion,
  busy,
  frozen,
  dirty,
  worldbook,
  regexAssets,
  worldbookError,
  regexError,
  worldbookUploaded,
  regexUploaded,
  check,
  onPickWorldbook,
  onPickRegex,
  onRemoveWorldbook,
  onRemoveRegex,
  onUploadWorldbook,
  onUploadRegex,
  onDelete,
  onNotice,
  onError,
}: {
  projectId: string;
  versionId: string | null;
  rowVersion: number;
  busy: boolean;
  frozen: boolean;
  dirty: boolean;
  worldbook: ReturnType<typeof useDraftAssetSelection>["worldbook"];
  regexAssets: ReturnType<typeof useDraftAssetSelection>["regexAssets"];
  worldbookError: string | null;
  regexError: string | null;
  worldbookUploaded: boolean;
  regexUploaded: boolean;
  check: ReturnType<typeof runLocalCheck>;
  onPickWorldbook: ReturnType<typeof useDraftAssetSelection>["pickWorldbook"];
  onPickRegex: ReturnType<typeof useDraftAssetSelection>["pickRegex"];
  onRemoveWorldbook: () => void;
  onRemoveRegex: (index: number) => void;
  onUploadWorldbook: () => void;
  onUploadRegex: () => void;
  onDelete: (kind: "worldbook" | "regex", key: string) => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <section id="editor-sec-files" className="workspace-section authoring-section authoring-card">
      <h3>③ 内容文件与本地预检</h3>
      <AssetPicker
        worldbook={worldbook}
        regexAssets={regexAssets}
        worldbookError={worldbookError}
        regexError={regexError}
        worldbookUploaded={worldbookUploaded}
        regexUploaded={regexUploaded}
        busy={busy || frozen}
        onPickWorldbook={onPickWorldbook}
        onPickRegex={onPickRegex}
        onRemoveWorldbook={onRemoveWorldbook}
        onRemoveRegex={onRemoveRegex}
        onUploadWorldbook={onUploadWorldbook}
        onUploadRegex={onUploadRegex}
      />
      {check ? (
        <CheckPanel
          check={check}
          worldbook={worldbook}
          regexAssets={regexAssets}
          onNotice={onNotice}
          onError={onError}
        />
      ) : null}
      <CurrentVersionEntries
        projectId={projectId}
        versionId={versionId}
        rowVersion={rowVersion}
        busy={busy}
        frozen={frozen}
        dirty={dirty}
        onDelete={onDelete}
      />
    </section>
  );
}
