import assert from 'node:assert/strict';

function get(object, path) {
  return String(path)
    .split('.')
    .reduce((value, key) => (value == null ? undefined : value[key]), object);
}

globalThis._ = {
  get,
  isString: value => typeof value === 'string',
  isNumber: value => typeof value === 'number',
};

const {
  getCreativeWorkshopFiniteNumber,
  getCreativeWorkshopPositionRole,
  getCreativeWorkshopPositionType,
  getCreativeWorkshopSecondaryLogic,
  getCreativeWorkshopStrategyType,
} = await import('../../src/CreativeWorkshop/services/worldbook-normalize.ts');

const positionCases = [
  [0, 'before_character_definition'],
  [1, 'after_character_definition'],
  [2, 'before_author_note'],
  [3, 'after_author_note'],
  [4, 'at_depth'],
  [5, 'before_example_messages'],
  [6, 'after_example_messages'],
  [7, 'outlet'],
];
for (const [position, expected] of positionCases) {
  assert.equal(getCreativeWorkshopPositionType({ position }), expected);
}

assert.equal(
  getCreativeWorkshopPositionType({ position: { type: 'before_character_definition', depth: 4 } }),
  'before_character_definition',
);
assert.equal(getCreativeWorkshopPositionType({ positionType: 'before_char' }), 'before_character_definition');
assert.equal(getCreativeWorkshopPositionType({ position: { type: 'outlet' }, outletName: 'AfterStatus' }), 'outlet');
assert.throws(() => getCreativeWorkshopPositionType({ position: 999 }), /不支持/);

assert.equal(getCreativeWorkshopStrategyType({ constant: true, position: 0 }), 'constant');
assert.equal(getCreativeWorkshopStrategyType({ constant: false, vectorized: false, selective: false }), 'selective');
assert.equal(getCreativeWorkshopStrategyType({ vectorized: true }), 'vectorized');
assert.throws(() => getCreativeWorkshopStrategyType({ strategyType: 'banana' }), /不支持/);

const logicCases = [
  [0, 'and_any'],
  [1, 'not_all'],
  [2, 'not_any'],
  [3, 'and_all'],
];
for (const [selectiveLogic, expected] of logicCases) {
  assert.equal(getCreativeWorkshopSecondaryLogic({ selectiveLogic }), expected);
}
assert.equal(getCreativeWorkshopSecondaryLogic({ secondaryLogic: 'not_any' }), 'not_any');
assert.throws(() => getCreativeWorkshopSecondaryLogic({ selectiveLogic: 99 }), /不支持/);

assert.equal(getCreativeWorkshopFiniteNumber({ order: 601 }, 'position.order', 'order', 0), 601);
assert.equal(getCreativeWorkshopFiniteNumber({ order: -20 }, 'position.order', 'order', 0), -20);
assert.equal(getCreativeWorkshopFiniteNumber({ position: { depth: 4 } }, 'position.depth', 'depth', 0), 4);
assert.throws(() => getCreativeWorkshopFiniteNumber({ order: '601' }, 'position.order', 'order', 0), /有限数字/);

assert.equal(getCreativeWorkshopPositionRole({ role: 2 }, 'at_depth'), 'assistant');
assert.equal(getCreativeWorkshopPositionRole({ role: 'nonsense' }, 'before_character_definition'), 'system');
assert.throws(() => getCreativeWorkshopPositionRole({ role: 'nonsense' }, 'at_depth'), /不支持/);

console.log('worldbook normalization matrix OK');
