import type { InstallLocation, InstallScan } from "../../../packages/contracts/src/install.js";
import {
  copy,
  type Discovery,
  differences,
  type Group,
  guidance,
  type Identity,
  type InstallHost,
  identity,
  isRow,
  MANIFEST,
  REGEX_RECORD,
  type Row,
  regexIdentity,
  type Snapshot,
} from "./install-model.js";

export async function capture(host: InstallHost) {
  const names = [...host.names()].sort();
  const character = host.character();
  const books = new Map<string, Row[]>();
  const failures: InstallScan["failures"] = [];
  for (const name of names) {
    try {
      books.set(name, copy(await host.book(name)));
    } catch (error) {
      failures.push({ location: name, reason: String(error) });
    }
  }
  let regex: Row[] = [];
  try {
    if (character) regex = copy(host.regex());
  } catch (error) {
    failures.push({ location: `角色:${character}`, reason: String(error) });
  }
  if (character !== host.character()) throw new Error("扫描期间角色已改变，请重新扫描");
  return { names, character, books, regex, failures, bindings: copy(host.bindings()), records: copy(host.records()) };
}
function legacyRegexAssignments(
  snapshot: Snapshot,
  assigned: Map<string, Identity>,
  suspect: (location: string, reason: string, scope: { book?: string; character?: boolean }) => void,
) {
  const { books, character, regex } = snapshot;
  const parseRecord = (input: unknown) => {
    if (!isRow(input)) throw new Error("正则记录格式错误");
    const record = input;
    if (
      record.schemaVersion !== 1 ||
      typeof record.projectId !== "string" ||
      !record.projectId ||
      !Array.isArray(record.entries) ||
      typeof record.installedVersion !== "string" ||
      !record.installedVersion
    )
      throw new Error("正则记录缺少可靠身份或版本");
    const keys = new Set<string>();
    for (const entry of record.entries) {
      if (!entry.regexId || !entry.entryKey || keys.has(entry.entryKey) || assigned.has(entry.regexId))
        throw new Error("正则记录存在重复身份");
      keys.add(entry.entryKey);
      assigned.set(entry.regexId, {
        projectId: record.projectId,
        version: entry.installedVersion ?? record.installedVersion,
        key: entry.entryKey,
      });
    }
  };
  for (const [name, rows] of books)
    for (const row of rows) {
      if (!String(row.content ?? "").startsWith(MANIFEST)) continue;
      try {
        const manifest: unknown = JSON.parse(String(row.content).slice(MANIFEST.length));
        if (!isRow(manifest)) throw new Error("角色正则记录格式错误");
        if (manifest.characterAvatar !== character) continue;
        if (
          row.enabled !== false ||
          manifest.schemaVersion !== 1 ||
          !Array.isArray(manifest.pending) ||
          manifest.pending.length ||
          !Array.isArray(manifest.projects)
        )
          throw new Error("角色正则记录启用、损坏或写入未完成");
        for (const record of manifest.projects) parseRecord(record);
      } catch (error) {
        suspect(name, String(error), { book: name });
        suspect(`角色:${character}`, "主世界书中的角色正则归属记录不可靠", { character: true });
      }
    }
  const recordRows = new Set<Row>();
  for (const row of regex)
    if (String(row.replace_string ?? "").startsWith(REGEX_RECORD)) {
      try {
        const record: unknown = JSON.parse(String(row.replace_string).slice(REGEX_RECORD.length));
        if (!isRow(record) || row.enabled !== false || row.id !== record.projectId)
          throw new Error("正则记录启用或身份不一致");
        parseRecord(record);
        recordRows.add(row);
      } catch (error) {
        suspect(`角色:${character}`, String(error), { character: true });
      }
    }
  return recordRows;
}
function discoverRegex(
  snapshot: Snapshot,
  add: (row: Row, id: Identity, location: InstallLocation, kind: "book" | "regex") => void,
  suspect: (location: string, reason: string, scope: { book?: string; character?: boolean }) => void,
) {
  const { character, regex, records } = snapshot;
  const assigned = new Map<string, Identity>();
  for (const [instanceId, record] of Object.entries(records)) {
    if (record.instance.location.character !== character) continue;
    for (const [index, row] of record.baseline.regex.entries()) {
      if (row.id)
        assigned.set(row.id, {
          instanceId,
          projectId: record.instance.projectId,
          version: record.instance.version,
          key: String(row.extensions?.cw_entry_key ?? index),
        });
    }
  }
  const recordRows = legacyRegexAssignments(snapshot, assigned, suspect);
  for (const row of regex) {
    if (recordRows.has(row)) continue;
    try {
      const id = assigned.get(String(row.id)) ?? regexIdentity(row);
      if (id) add(row, id, { worldbook: null, character }, "regex");
    } catch (error) {
      suspect(`角色:${character} / ${row.id}`, String(error), { character: true });
    }
  }
}
function finalizeGroups(
  snapshot: Snapshot,
  groups: Map<string, Group>,
  ambiguous: InstallScan["ambiguous"],
  suspect: (location: string, reason: string, scope: { book?: string; character?: boolean }) => void,
) {
  const { records, books, character } = snapshot;
  for (const [id, record] of Object.entries(records)) {
    if (record.instance.location.character && record.instance.location.character !== character) continue;
    if (!groups.has(id) && (!record.instance.location.worldbook || books.has(record.instance.location.worldbook)))
      groups.set(id, { instance: copy(record.instance), book: [], regex: [] });
  }
  const clearedPending: string[] = [];
  if (!snapshot.failures.length && !ambiguous.length) {
    for (const [id, record] of Object.entries(records)) {
      if (!record.pending || (record.instance.location.character && record.instance.location.character !== character))
        continue;
      const group = groups.get(id);
      if (!group?.book.length && !group?.regex.length) {
        clearedPending.push(id);
        groups.delete(id);
      }
    }
  }
  for (const [id, group] of groups) {
    if (records[id]?.pending) {
      group.invalid = true;
      suspect(
        group.instance.location.worldbook ?? `角色:${character}`,
        "安装操作中断，持久归属记录尚未验收；请手动卸载所属内容后重新下载",
        group.instance.location.worldbook ? { book: group.instance.location.worldbook } : { character: true },
      );
      if (group.instance.location.character)
        suspect(`角色:${character}`, "存在未完成的正则安装记录", { character: true });
    }
    group.instance.entryCount = group.book.length;
    group.instance.regexCount = group.regex.length;
    const baseline = records[id]?.baseline;
    if (baseline)
      group.instance.state =
        differences("worldbook", baseline.book, group.book).length ||
        differences("regex", baseline.regex, group.regex).length
          ? "localChanged"
          : "clean";
  }
  return clearedPending;
}
function instanceAssembler(
  snapshot: Snapshot,
  groups: Map<string, Group>,
  suspect: (location: string, reason: string, scope: { book?: string; character?: boolean }) => void,
) {
  const { character, records } = snapshot;
  const seenKeys = new Map<string, Set<string>>();
  function add(row: Row, id: Identity, location: InstallLocation, kind: "book" | "regex") {
    const instanceId =
      id.instanceId ??
      `legacy:${encodeURIComponent(id.projectId)}:${kind}:${encodeURIComponent(location.worldbook ?? location.character ?? "")}`;
    let group = groups.get(instanceId);
    if (!group) {
      group = {
        instance: {
          instanceId,
          projectId: id.projectId,
          version: id.version,
          location,
          source: id.instanceId ? "native" : "legacy",
          state: "baselineUnknown",
          entryCount: 0,
          regexCount: 0,
        },
        book: [],
        regex: [],
      };
      groups.set(instanceId, group);
    }
    const old = group.instance;
    const remembered = records[instanceId]?.instance;
    if (remembered) {
      if (
        (kind === "book" && remembered.location.worldbook !== location.worldbook) ||
        (kind === "regex" && remembered.location.character !== character)
      ) {
        group.invalid = true;
        suspect(
          location.worldbook ?? `角色:${character}`,
          "实例标记被复制到非登记位置",
          location.worldbook ? { book: location.worldbook } : { character: true },
        );
      }
      old.location = copy(remembered.location);
    }
    const keySet = seenKeys.get(`${instanceId}:${kind}`) ?? new Set<string>();
    const duplicate = keySet.has(id.key);
    keySet.add(id.key);
    seenKeys.set(`${instanceId}:${kind}`, keySet);
    if (
      old.projectId !== id.projectId ||
      old.version !== id.version ||
      (kind === "book" && old.location.worldbook && old.location.worldbook !== location.worldbook) ||
      duplicate
    ) {
      group.invalid = true;
      suspect(
        location.worldbook ?? `角色:${character}`,
        "实例身份、版本或条目身份冲突",
        location.worldbook ? { book: location.worldbook } : { character: true },
      );
    }
    if (kind === "book") old.location.worldbook = location.worldbook;
    if (kind === "regex") old.location.character = character;
    group[kind].push(row);
  }
  return add;
}
export function discover(snapshot: Snapshot): Discovery {
  const { books, character } = snapshot;
  const ambiguous: InstallScan["ambiguous"] = [];
  const groups = new Map<string, Group>();
  const ambiguousBooks = new Set<string>();
  let ambiguousCharacter = false;
  const suspect = (location: string, reason: string, scope: { book?: string; character?: boolean }) => {
    if (scope.book !== undefined) ambiguousBooks.add(scope.book);
    if (scope.character) ambiguousCharacter = true;
    ambiguous.push({ location, reason, guidance });
  };
  const add = instanceAssembler(snapshot, groups, suspect);
  for (const [name, rows] of books)
    for (const [index, row] of rows.entries()) {
      if (String(row.content ?? "").startsWith(MANIFEST)) continue;
      try {
        const id = identity(row);
        if (id) add(row, id, { worldbook: name, character: null }, "book");
      } catch (error) {
        suspect(`${name} / ${row.uid ?? index}`, String(error), { book: name });
      }
    }
  discoverRegex(snapshot, add, suspect);
  const clearedPending = finalizeGroups(snapshot, groups, ambiguous, suspect);
  return {
    clearedPending,
    groups,
    ambiguousBooks,
    ambiguousCharacter,
    scan: {
      instances: [...groups.values()].filter((g) => !g.invalid).map((g) => g.instance),
      scope: {
        worldbooks: snapshot.names,
        character,
        regex: "current-character-only",
        otherCharacters: "not-scanned",
      },
      failures: snapshot.failures,
      ambiguous,
    } as InstallScan,
  };
}
