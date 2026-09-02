import type { RegexEntryPreviewType, WorldbookEntryPreviewType } from '../types';
import { extractProjectEntries } from './project-content';

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseWorldbookEntriesPreview(projectFileText: string): WorldbookEntryPreviewType[] {
  const raw = safeParseJson(projectFileText);
  const entries = extractProjectEntries(raw, 'worldbook');

  return entries.map(({ entry: item, entryKey }, index) => {
    const strategy = item.strategy && typeof item.strategy === 'object' ? (item.strategy as Record<string, unknown>) : null;
    const secondary =
      strategy?.keys_secondary && typeof strategy.keys_secondary === 'object'
        ? (strategy.keys_secondary as Record<string, unknown>)
        : null;
    const primaryKeys = Array.isArray(strategy?.keys)
      ? strategy.keys
      : Array.isArray(item.key)
        ? item.key
        : Array.isArray(item.keys)
          ? item.keys
          : [];
    const secondaryKeys = Array.isArray(secondary?.keys)
      ? secondary.keys
      : Array.isArray(item.keysecondary)
        ? item.keysecondary
        : Array.isArray(item.key_secondary)
          ? item.key_secondary
          : [];
    const positionObject =
      item.position && typeof item.position === 'object' ? (item.position as Record<string, unknown>) : null;

    return {
      entryKey,
      uid: typeof item.uid === 'string' || typeof item.uid === 'number' ? String(item.uid) : String(index),
      comment: typeof item.comment === 'string' ? item.comment : typeof item.name === 'string' ? item.name : '无标题',
      content: typeof item.content === 'string' ? item.content : typeof item.text === 'string' ? item.text : '',
      key: primaryKeys.filter(key => typeof key === 'string'),
      keysecondary: secondaryKeys.filter(key => typeof key === 'string'),
      constant: Boolean(item.constant),
      vectorized: Boolean(item.vectorized),
      selective: Boolean(item.selective),
      strategyType:
        strategy?.type === 'constant' || strategy?.type === 'selective' || strategy?.type === 'vectorized'
          ? strategy.type
          : undefined,
      secondaryLogic:
        secondary?.logic === 'and_any' ||
        secondary?.logic === 'not_all' ||
        secondary?.logic === 'not_any' ||
        secondary?.logic === 'and_all'
          ? secondary.logic
          : undefined,
      selectiveLogic:
        typeof item.selectiveLogic === 'number'
          ? item.selectiveLogic
          : typeof item.selective_logic === 'number'
            ? item.selective_logic
            : 0,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : !item.disable,
      disable: Boolean(item.disable),
      scanDepth:
        typeof strategy?.scan_depth === 'number' || strategy?.scan_depth === null
          ? (strategy.scan_depth as number | null)
          : typeof item.scanDepth === 'number'
            ? item.scanDepth
            : item.scanDepth === null
              ? null
              : null,
      position: typeof item.position === 'number' ? item.position : undefined,
      positionType:
        typeof positionObject?.type === 'string'
          ? positionObject.type
          : typeof item.positionType === 'string'
            ? item.positionType
            : undefined,
      outletName: typeof item.outletName === 'string' ? item.outletName : undefined,
      role:
        typeof positionObject?.role === 'string' || typeof positionObject?.role === 'number'
          ? positionObject.role
          : typeof item.role === 'string' || typeof item.role === 'number'
            ? item.role
            : null,
      depth: typeof positionObject?.depth === 'number' ? positionObject.depth : typeof item.depth === 'number' ? item.depth : 4,
      order: typeof positionObject?.order === 'number' ? positionObject.order : typeof item.order === 'number' ? item.order : index,
      probability: typeof item.probability === 'number' ? item.probability : 100,
      useProbability: Boolean(item.useProbability),
      sticky: typeof item.sticky === 'number' ? item.sticky : 0,
      cooldown: typeof item.cooldown === 'number' ? item.cooldown : 0,
      delay: typeof item.delay === 'number' ? item.delay : 0,
      excludeRecursion: Boolean(item.excludeRecursion),
      preventRecursion: Boolean(item.preventRecursion),
      delayUntilRecursion: Boolean(item.delayUntilRecursion),
      extra: typeof item.extensions === 'object' && item.extensions ? item.extensions : {},
    };
  });
}

export function parseRegexEntriesPreview(regexFileText: string): RegexEntryPreviewType[] {
  const raw = safeParseJson(regexFileText);
  const entries = extractProjectEntries(raw, 'regex');

  return entries.map(({ entry: item, entryKey }, index) => ({
    entryKey,
    id: typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : String(index),
    scriptName:
      typeof item.scriptName === 'string'
        ? item.scriptName
        : typeof item.script_name === 'string'
          ? item.script_name
          : undefined,
    findRegex:
      typeof item.findRegex === 'string'
        ? item.findRegex
        : typeof item.find_regex === 'string'
          ? item.find_regex
          : undefined,
    replaceString:
      typeof item.replaceString === 'string'
        ? item.replaceString
        : typeof item.replace_string === 'string'
          ? item.replace_string
          : undefined,
    trimStrings: Array.isArray(item.trimStrings)
      ? item.trimStrings.filter(value => typeof value === 'string')
      : Array.isArray(item.trim_strings)
        ? item.trim_strings.filter(value => typeof value === 'string')
        : [],
    disabled: Boolean(item.disabled),
    markdownOnly: Boolean(item.markdownOnly ?? item.markdown_only),
    promptOnly: Boolean(item.promptOnly ?? item.prompt_only),
    runOnEdit: Boolean(item.runOnEdit ?? item.run_on_edit),
    substituteRegex:
      typeof item.substituteRegex === 'number' || typeof item.substituteRegex === 'boolean'
        ? item.substituteRegex
        : typeof item.substitute_regex === 'number' || typeof item.substitute_regex === 'boolean'
          ? item.substitute_regex
          : 0,
    minDepth: typeof item.minDepth === 'number' ? item.minDepth : typeof item.min_depth === 'number' ? item.min_depth : null,
    maxDepth: typeof item.maxDepth === 'number' ? item.maxDepth : typeof item.max_depth === 'number' ? item.max_depth : null,
    placement: Array.isArray(item.placement) ? item.placement.filter(value => typeof value === 'number') : [],
  }));
}
