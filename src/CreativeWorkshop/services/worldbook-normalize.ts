export function getCreativeWorkshopWorldbookEntryKey(entry: Record<string, any>, index: number): string {
  if (_.isString(entry.entryKey) && entry.entryKey) return entry.entryKey;
  if (_.isString(entry.__cwEntryKey) && entry.__cwEntryKey) return entry.__cwEntryKey;
  const uid = entry.uid ?? _.get(entry, 'extensions.cw_entry_id');
  return uid !== undefined && uid !== null ? `uid:${String(uid)}` : `index:${index}`;
}

export function getCreativeWorkshopStrategyType(entry: Record<string, any>): WorldbookEntry['strategy']['type'] {
  const type = _.get(entry, 'strategy.type') ?? entry.strategyType;
  if (type !== undefined && type !== null) {
    if (type === 'constant' || type === 'selective' || type === 'vectorized') return type;
    throw new Error(`不支持的触发策略: ${String(type)}`);
  }
  if (entry.constant === true) return 'constant';
  if (entry.vectorized === true) return 'vectorized';
  return 'selective';
}

export function getCreativeWorkshopSecondaryLogic(
  entry: Record<string, any>,
): WorldbookEntry['strategy']['keys_secondary']['logic'] {
  const logic = _.get(entry, 'strategy.keys_secondary.logic') ?? entry.secondaryLogic;
  if (logic !== undefined && logic !== null) {
    if (logic === 'and_any' || logic === 'not_all' || logic === 'not_any' || logic === 'and_all') return logic;
    throw new Error(`不支持的次要关键词逻辑: ${String(logic)}`);
  }

  const raw = entry.selectiveLogic ?? entry.selective_logic ?? 0;
  if (!Number.isInteger(raw)) throw new Error(`selectiveLogic 必须是整数: ${String(raw)}`);
  switch (raw) {
    case 0:
      return 'and_any';
    case 1:
      return 'not_all';
    case 2:
      return 'not_any';
    case 3:
      return 'and_all';
    default:
      throw new Error(`不支持的 selectiveLogic: ${String(raw)}`);
  }
}

export type CreativeWorkshopPositionType = WorldbookEntry['position']['type'] | 'outlet';

export function getCreativeWorkshopPositionType(entry: Record<string, any>): CreativeWorkshopPositionType {
  const type = _.get(entry, 'position.type') ?? entry.positionType;
  if (type !== undefined && type !== null) {
    switch (type) {
      case 'before_character_definition':
      case 'after_character_definition':
      case 'before_example_messages':
      case 'after_example_messages':
      case 'before_author_note':
      case 'after_author_note':
      case 'at_depth':
      case 'outlet':
        return type;
      case 'before_char':
        return 'before_character_definition';
      case 'after_char':
        return 'after_character_definition';
      default:
        throw new Error(`不支持的插入位置: ${String(type)}`);
    }
  }

  const raw = entry.position ?? 0;
  if (!Number.isInteger(raw)) throw new Error(`插入位置必须是整数: ${String(raw)}`);
  switch (raw) {
    case 0:
      return 'before_character_definition';
    case 1:
      return 'after_character_definition';
    case 2:
      return 'before_author_note';
    case 3:
      return 'after_author_note';
    case 4:
      return 'at_depth';
    case 5:
      return 'before_example_messages';
    case 6:
      return 'after_example_messages';
    case 7:
      return 'outlet';
    default:
      throw new Error(`不支持的 SillyTavern 插入位置: ${String(raw)}`);
  }
}

export function getCreativeWorkshopPositionRole(
  entry: Record<string, any>,
  positionType: CreativeWorkshopPositionType,
): WorldbookEntry['position']['role'] {
  const role = _.get(entry, 'position.role') ?? entry.role;
  switch (role) {
    case 0:
    case 'system':
      return 'system';
    case 1:
    case 'user':
      return 'user';
    case 2:
    case 'assistant':
      return 'assistant';
    case undefined:
    case null:
      return 'system';
    default:
      if (positionType !== 'at_depth') return 'system';
      throw new Error(`不支持的 @D role: ${String(role)}`);
  }
}

export function getCreativeWorkshopFiniteNumber(
  entry: Record<string, any>,
  rawPath: string,
  previewPath: string,
  defaultValue: number,
): number {
  const value = _.get(entry, rawPath) ?? _.get(entry, previewPath);
  if (value === undefined || value === null) return defaultValue;
  if (!_.isNumber(value) || !Number.isFinite(value)) {
    throw new Error(`${previewPath} 必须是有限数字: ${String(value)}`);
  }
  return value;
}
