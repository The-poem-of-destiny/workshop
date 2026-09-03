const CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY = 'creative_workshop_install_registry';

export type CreativeWorkshopInstallRecord = {
  projectId: string;
  worldbookName: string;
  installedAt: number;
};

type CreativeWorkshopInstallRegistry = Record<string, Record<string, CreativeWorkshopInstallRecord>>;

function getRegistryScopeKey() {
  return getCurrentCharacterName() || '__no_character__';
}

function readInstallRegistry(): CreativeWorkshopInstallRegistry {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = _.get(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY);
  return _.isObject(raw) ? (raw as CreativeWorkshopInstallRegistry) : {};
}

function writeInstallRegistry(registry: CreativeWorkshopInstallRegistry) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY, registry);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

export function getCreativeWorkshopInstallRecords(): Record<string, CreativeWorkshopInstallRecord> {
  return readInstallRegistry()[getRegistryScopeKey()] || {};
}

export function getCreativeWorkshopInstallRecord(projectId: string): CreativeWorkshopInstallRecord | null {
  return getCreativeWorkshopInstallRecords()[projectId] || null;
}

export async function resolveCreativeWorkshopInstallWorldbook(projectId: string): Promise<string | null> {
  const recorded = getCreativeWorkshopInstallRecord(projectId);
  if (recorded?.worldbookName) return recorded.worldbookName;

  const charWorldbooks = getCharWorldbookNames('current');
  const candidates = _.uniq([charWorldbooks.primary, ...(charWorldbooks.additional || [])]).filter(
    (name): name is string => _.isString(name) && Boolean(name),
  );
  const existingNames = new Set(getWorldbookNames());

  for (const worldbookName of candidates) {
    if (!existingNames.has(worldbookName)) continue;
    const entries = await getWorldbook(worldbookName);
    if (
      entries.some(
        entry =>
          _.get(entry, 'extra.cw_project_id') === projectId || _.get(entry, 'extra.fate_project_name') === projectId,
      )
    ) {
      return worldbookName;
    }
  }

  return null;
}

export function setCreativeWorkshopInstallRecord(projectId: string, worldbookName: string) {
  const registry = readInstallRegistry();
  const scopeKey = getRegistryScopeKey();
  registry[scopeKey] = registry[scopeKey] || {};
  registry[scopeKey][projectId] = {
    projectId,
    worldbookName,
    installedAt: Date.now(),
  };
  writeInstallRegistry(registry);
}

export function deleteCreativeWorkshopInstallRecord(projectId: string) {
  const registry = readInstallRegistry();
  const scopeKey = getRegistryScopeKey();
  if (!registry[scopeKey]?.[projectId]) return;
  delete registry[scopeKey][projectId];
  if (Object.keys(registry[scopeKey]).length === 0) {
    delete registry[scopeKey];
  }
  writeInstallRegistry(registry);
}
