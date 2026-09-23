export const CREATIVE_WORKSHOP_WORLD_BOOK_META_START = '<%# poem-workshop-meta:v1-start\n';
export const CREATIVE_WORKSHOP_WORLD_BOOK_META_END = '\npoem-workshop-meta:v1-end %>';
const CREATIVE_WORKSHOP_REGEX_ID_PREFIX = 'creative_workshop:';

export type CreativeWorkshopWorldbookMetadata = {
  cw_project_id: string;
  cw_project_name_display: string;
  cw_project_version: string | null;
  cw_remote_version?: string | null;
  cw_entry_key: string;
  cw_name_format_version: string | number;
};

export type CreativeWorkshopRegexIdentity = {
  schemaVersion: 0 | 1;
  projectId: string;
  entryKey: string;
  installedVersion: string | null;
};

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function meaningfulMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return value ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return value === null ? null : value;
}

function safeMetadataJson(metadata: CreativeWorkshopWorldbookMetadata): string {
  return JSON.stringify(metadata)
    .replace(/%/g, '\\u0025')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

export function buildCreativeWorkshopWorldbookMetadataBlock(
  metadata: CreativeWorkshopWorldbookMetadata,
): string {
  return `${CREATIVE_WORKSHOP_WORLD_BOOK_META_START}${safeMetadataJson(metadata)}${CREATIVE_WORKSHOP_WORLD_BOOK_META_END}`;
}

export function stripCreativeWorkshopWorldbookMetadata(content: string): string {
  if (!content.startsWith(CREATIVE_WORKSHOP_WORLD_BOOK_META_START)) return content;
  const endIndex = content.indexOf(
    CREATIVE_WORKSHOP_WORLD_BOOK_META_END,
    CREATIVE_WORKSHOP_WORLD_BOOK_META_START.length,
  );
  if (endIndex < 0) return content;
  return content.slice(endIndex + CREATIVE_WORKSHOP_WORLD_BOOK_META_END.length);
}

export function injectCreativeWorkshopWorldbookMetadata(
  originalContent: string,
  metadata: CreativeWorkshopWorldbookMetadata,
): string {
  const content = typeof originalContent === 'string' ? originalContent : '';
  const hadWorkshopMarker = content.startsWith(CREATIVE_WORKSHOP_WORLD_BOOK_META_START);
  const stripped = stripCreativeWorkshopWorldbookMetadata(content);
  if (hadWorkshopMarker && stripped === content) {
    throw new Error('世界书内容中的工坊身份标记不完整');
  }
  return buildCreativeWorkshopWorldbookMetadataBlock(metadata) + stripped;
}

export function readCreativeWorkshopWorldbookMetadata(
  content: string,
): CreativeWorkshopWorldbookMetadata | null {
  if (typeof content !== 'string' || !content.startsWith(CREATIVE_WORKSHOP_WORLD_BOOK_META_START)) {
    return null;
  }
  const endIndex = content.indexOf(
    CREATIVE_WORKSHOP_WORLD_BOOK_META_END,
    CREATIVE_WORKSHOP_WORLD_BOOK_META_START.length,
  );
  if (endIndex < 0) return null;

  const raw = content.slice(CREATIVE_WORKSHOP_WORLD_BOOK_META_START.length, endIndex);
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return null;
    if (typeof parsed.cw_project_id !== 'string' || !parsed.cw_project_id) return null;
    if (typeof parsed.cw_entry_key !== 'string' || !parsed.cw_entry_key) return null;
    if (typeof parsed.cw_project_name_display !== 'string') return null;
    if (
      parsed.cw_project_version !== null &&
      parsed.cw_project_version !== undefined &&
      typeof parsed.cw_project_version !== 'string'
    ) return null;
    if (
      parsed.cw_remote_version !== null &&
      parsed.cw_remote_version !== undefined &&
      typeof parsed.cw_remote_version !== 'string'
    ) return null;
    if (
      typeof parsed.cw_name_format_version !== 'string' &&
      !(typeof parsed.cw_name_format_version === 'number' && Number.isFinite(parsed.cw_name_format_version))
    ) return null;

    return {
      cw_project_id: parsed.cw_project_id,
      cw_project_name_display: parsed.cw_project_name_display,
      cw_project_version: parsed.cw_project_version ?? null,
      ...(parsed.cw_remote_version !== undefined ? { cw_remote_version: parsed.cw_remote_version ?? null } : {}),
      cw_entry_key: parsed.cw_entry_key,
      cw_name_format_version: parsed.cw_name_format_version,
    };
  } catch {
    return null;
  }
}

export function getCreativeWorkshopWorldbookMetadataValue(
  entry: WorldbookEntry | Record<string, any>,
  field: string,
): unknown {
  const raw = entry as Record<string, any>;
  const extra = asRecord(raw.extra);
  const direct = meaningfulMetadataValue(extra?.[field]);
  if (direct !== undefined && direct !== null) return direct;

  const embedded = readCreativeWorkshopWorldbookMetadata(
    typeof raw.content === 'string' ? raw.content : '',
  ) as Record<string, any> | null;
  const fallback = meaningfulMetadataValue(embedded?.[field]);
  return fallback === undefined ? null : fallback;
}

export function getCreativeWorkshopWorldbookMetadataString(
  entry: WorldbookEntry | Record<string, any>,
  field: string,
): string | null {
  const value = getCreativeWorkshopWorldbookMetadataValue(entry, field);
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function encodeRegexIdentityComponent(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A');
}

function decodeRegexIdentityComponent(value: string): string {
  return value.replace(/%3A/gi, ':').replace(/%25/gi, '%');
}

export function buildCreativeWorkshopRegexId(
  projectId: string,
  entryKey: string,
  installedVersion?: string | null,
): string {
  const normalizedProjectId = String(projectId || '');
  if (!normalizedProjectId) throw new Error('Workshop regex projectId 不能为空');
  if (normalizedProjectId.includes(':')) {
    throw new Error('Workshop regex projectId 不能包含冒号');
  }
  const normalizedEntryKey = String(entryKey || '');
  if (!normalizedEntryKey) throw new Error('Workshop regex entryKey 不能为空');

  return `${CREATIVE_WORKSHOP_REGEX_ID_PREFIX}${normalizedProjectId}:v1:${encodeRegexIdentityComponent(normalizedEntryKey)}:${encodeRegexIdentityComponent(installedVersion || '')}`;
}

export function parseCreativeWorkshopRegexId(value: string): CreativeWorkshopRegexIdentity | null {
  const raw = String(value || '');
  if (!raw.startsWith(CREATIVE_WORKSHOP_REGEX_ID_PREFIX)) return null;

  const rest = raw.slice(CREATIVE_WORKSHOP_REGEX_ID_PREFIX.length);
  const projectSeparator = rest.indexOf(':');
  if (projectSeparator <= 0) return null;

  const projectId = rest.slice(0, projectSeparator);
  const tail = rest.slice(projectSeparator + 1);
  if (!tail) return null;

  if (tail.startsWith('v1:')) {
    const payload = tail.slice('v1:'.length);
    const versionSeparator = payload.indexOf(':');
    if (versionSeparator < 0) return null;
    const entryKey = decodeRegexIdentityComponent(payload.slice(0, versionSeparator));
    const installedVersion = decodeRegexIdentityComponent(payload.slice(versionSeparator + 1)) || null;
    if (!entryKey) return null;
    return { schemaVersion: 1, projectId, entryKey, installedVersion };
  }

  return {
    schemaVersion: 0,
    projectId,
    entryKey: tail,
    installedVersion: null,
  };
}

export function getCreativeWorkshopRegexIdentityKey(projectId: string, entryKey: string): string {
  return JSON.stringify([projectId, entryKey]);
}
