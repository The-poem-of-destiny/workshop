export interface ClientChannel {
  revision: string;
  version: string;
  size?: number;
  sha256?: string;
  publishedAt?: string;
}

export type ClientChannels = Record<string, ClientChannel>;

export async function getClientChannels(db: D1Database): Promise<ClientChannels> {
  const row = await db.prepare("SELECT value FROM site_settings WHERE key = 'client_channels'")
    .first<{ value: string }>();
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ClientChannels;
  } catch {
    return {};
  }
}

export async function getClientChannel(
  db: D1Database,
  channel: string,
): Promise<ClientChannel | null> {
  if (channel !== "stable" && channel !== "staging") return null;
  const channels = await getClientChannels(db);
  return Object.hasOwn(channels, channel) ? channels[channel] ?? null : null;
}
