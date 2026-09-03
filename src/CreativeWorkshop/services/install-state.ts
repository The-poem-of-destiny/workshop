import { getCreativeWorkshopRegexId } from './regex-name';

export type CreativeWorkshopInstalledProject = {
  projectId: string;
  name: string;
  localVersion: string | null;
  remoteVersion: string | null;
  entryCount: number;
  regexCount: number;
  canUpdate: boolean;
  hasUpdate: boolean;
};

export async function listInstalledCreativeWorkshopProjects(): Promise<CreativeWorkshopInstalledProject[]> {
  const charWorldbooks = getCharWorldbookNames('current');
  const entries = charWorldbooks.primary ? await getWorldbook(charWorldbooks.primary) : [];
  const groupedEntries = _.groupBy(
    entries.filter(
      entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')),
    ),
    entry => String(_.get(entry, 'extra.cw_project_id') || _.get(entry, 'extra.fate_project_name')),
  );

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const groupedRegexes = _.groupBy(
    regexes.filter(regex => getCreativeWorkshopRegexId(regex).startsWith('creative_workshop:')),
    regex => getCreativeWorkshopRegexId(regex).split(':')[1] || '',
  );

  return _.uniq([...Object.keys(groupedEntries), ...Object.keys(groupedRegexes)])
    .filter(Boolean)
    .map(projectId => {
      const projectEntries = groupedEntries[projectId] || [];
      const projectRegexes = groupedRegexes[projectId] || [];
      const firstEntry = projectEntries[0];
      const firstRegex = projectRegexes[0];
      const localVersion = firstEntry ? _.get(firstEntry, 'extra.cw_project_version', null) : null;
      return {
        projectId,
        name: firstEntry
          ? _.get(firstEntry, 'extra.cw_project_name_display', _.get(firstEntry, 'name', '未命名项目'))
          : _.get(firstRegex, 'script_name', '未命名项目'),
        localVersion,
        remoteVersion: null,
        entryCount: projectEntries.length,
        regexCount: projectRegexes.length,
        canUpdate: false,
        hasUpdate: false,
      } satisfies CreativeWorkshopInstalledProject;
    });
}
