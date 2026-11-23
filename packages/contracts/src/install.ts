export type InstallFileSet = { worldbook?: string; regex?: string };
export type InstallProject = {
  id: string;
  title?: string;
  description?: string | null;
  author?: { id: string; name: string } | null;
  version: string;
  versionLabel?: string | null;
};
export type InstallLocation = { worldbook: string | null; character: string | null };
export type InstallInstance = {
  instanceId: string;
  projectId: string;
  version: string;
  location: InstallLocation;
  source: "native" | "legacy";
  state: "clean" | "localChanged" | "baselineUnknown";
  entryCount: number;
  regexCount: number;
};
export type InstallScan = {
  instances: InstallInstance[];
  scope: {
    worldbooks: string[];
    character: string | null;
    regex: "current-character-only";
    otherCharacters: "not-scanned";
  };
  failures: { location: string; reason: string }[];
  ambiguous: { location: string; reason: string; guidance: string }[];
};
export type InstallIntent = {
  action: "install" | "update" | "uninstall" | "migrate";
  instanceId?: string;
  project?: InstallProject;
  files?: InstallFileSet;
  targetWorldbook?: string;
  createWorldbook?: boolean;
  bindWorldbook?: boolean;
};
export type InstallDiff = { kind: "worldbook" | "regex"; key: string; before: string | null; after: string | null };
export type InstallPreview = {
  previewId: string;
  instanceId: string;
  action: InstallIntent["action"];
  instance: InstallInstance | null;
  target: InstallLocation;
  playerChanges: InstallDiff[];
  changes: InstallDiff[];
};
