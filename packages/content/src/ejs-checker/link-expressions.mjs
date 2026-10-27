import { resolveBinding } from "./scope.mjs";

const GLOBALS = new Set(["window", "globalThis", "self"]);
const NETWORK_NAMES = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
const MEDIA_KEYS =
  /^(?:avatar(?:_?url)?|image(?:_?url)?|img(?:_?url)?|video(?:_?url)?|poster|portrait|thumbnail|cover(?:_?url)?|background(?:_?url)?|gallery)$/i;
const MEDIA_GROUPS = /^(?:gallery|images|videos|avatars|sources)$/i;

export function propertyName(node) {
  if (node?.type !== "MemberExpression" && node?.type !== "Property") return null;
  const property = node.type === "Property" ? node.key : node.property;
  if (!node.computed && property.type === "Identifier") return property.name;
  return property.type === "Literal" && typeof property.value === "string" ? property.value : null;
}

export function expressionEvidence(node) {
  return JSON.stringify(node, (key, value) =>
    ["start", "end", "loc", "range", "raw"].includes(key)
      ? undefined
      : typeof value === "bigint"
        ? String(value)
        : value,
  );
}

function product(left, right, join) {
  if (!left || !right || left.length * right.length > 64) return null;
  return [...new Set(left.flatMap((a) => right.map((b) => join(a, b))))];
}

export function staticStringValues(node, analysis, scope, visited = new Set(), evidence = new Set()) {
  if (!node || visited.has(node)) return null;
  evidence.add(node);
  visited = new Set(visited).add(node);
  if (node.type === "ChainExpression") return staticStringValues(node.expression, analysis, scope, visited, evidence);
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : null;
  if (node.type === "TemplateLiteral") {
    let values = [node.quasis[0].value.cooked];
    for (let i = 0; i < node.expressions.length; i++)
      values = product(
        values,
        staticStringValues(node.expressions[i], analysis, scope, visited, evidence),
        (a, b) => a + b + node.quasis[i + 1].value.cooked,
      );
    return values;
  }
  if (node.type === "BinaryExpression" && node.operator === "+")
    return product(
      staticStringValues(node.left, analysis, scope, visited, evidence),
      staticStringValues(node.right, analysis, scope, visited, evidence),
      (a, b) => a + b,
    );
  if (node.type === "ConditionalExpression") {
    const left = staticStringValues(node.consequent, analysis, scope, visited, evidence),
      right = staticStringValues(node.alternate, analysis, scope, visited, evidence);
    return left && right ? [...new Set([...left, ...right])] : null;
  }
  if (node.type === "Identifier") {
    const binding = resolveBinding(scope, node.name)?.[0];
    if (binding?.kind !== "const") return null;
    const declaration = analysis.nodes.find(
      (item) => item.node.type === "VariableDeclarator" && item.node.id === binding.node,
    );
    return declaration
      ? staticStringValues(declaration.node.init, analysis, declaration.scope, visited, evidence)
      : null;
  }
  if (
    node.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "URL" &&
    !resolveBinding(scope, "URL")
  ) {
    const paths = staticStringValues(node.arguments[0], analysis, scope, visited, evidence),
      bases = node.arguments[1] ? staticStringValues(node.arguments[1], analysis, scope, visited, evidence) : [""];
    if (!paths || !bases) return null;
    try {
      return product(paths, bases, (path, base) => (base ? new URL(path, base).href : new URL(path).href));
    } catch {
      return null;
    }
  }
  if (node.type === "MemberExpression" && node.object.type === "Identifier")
    return staticCollectionValues(node, analysis, scope, visited, evidence);
  return null;
}

function globalObject(node, scope) {
  if (node?.type === "Identifier") return GLOBALS.has(node.name) && !resolveBinding(scope, node.name);
  return (
    node?.type === "MemberExpression" &&
    ["window", "self", "globalThis", "top", "parent"].includes(propertyName(node)) &&
    globalObject(node.object, scope)
  );
}
export function networkCapability(node, analysis, scope, visited = new Set()) {
  if (node?.type === "ChainExpression") node = node.expression;
  if (node?.type === "Identifier" && NETWORK_NAMES.has(node.name) && !resolveBinding(scope, node.name))
    return node.name;
  if (node?.type === "MemberExpression" && NETWORK_NAMES.has(propertyName(node)) && globalObject(node.object, scope))
    return propertyName(node);
  if (node?.type !== "Identifier" || visited.has(node)) return null;
  visited = new Set(visited).add(node);
  const binding = resolveBinding(scope, node.name)?.[0];
  const declaration = binding
    ? analysis.nodes.find((item) => item.node.type === "VariableDeclarator" && item.node.id === binding.node)
    : null;
  return declaration ? networkCapability(declaration.node.init, analysis, declaration.scope, visited) : null;
}
function locationObject(node, scope) {
  return node?.type === "Identifier"
    ? node.name === "location" && !resolveBinding(scope, "location")
    : node?.type === "MemberExpression" && propertyName(node) === "location" && globalObject(node.object, scope);
}
export function navigationTarget(node, scope) {
  if (node.type === "CallExpression") {
    const callee = node.callee.type === "ChainExpression" ? node.callee.expression : node.callee;
    if (callee.type === "Identifier" && callee.name === "open" && !resolveBinding(scope, "open"))
      return { argument: node.arguments[0], action: "open" };
    if (callee.type === "MemberExpression" && propertyName(callee) === "open" && globalObject(callee.object, scope))
      return { argument: node.arguments[0], action: "window.open" };
    if (
      callee.type === "MemberExpression" &&
      ["assign", "replace"].includes(propertyName(callee)) &&
      locationObject(callee.object, scope)
    )
      return { argument: node.arguments[0], action: "location." + propertyName(callee) };
  }
  if (
    node.type === "AssignmentExpression" &&
    ((node.left.type === "MemberExpression" && ["href", "action", "formAction"].includes(propertyName(node.left))) ||
      locationObject(node.left, scope))
  )
    return { argument: node.right, action: "navigation.href" };
  if (
    node.type === "CallExpression" &&
    propertyName(node.callee) === "setAttribute" &&
    ["href", "action", "formaction"].includes(node.arguments[0]?.value)
  )
    return { argument: node.arguments[1], action: "navigation.setAttribute" };
  return null;
}
export function mediaContext(node, scope, parentByNode, analysis) {
  let current = node;
  while (current) {
    const parent = parentByNode.get(current);
    if (!parent) break;
    if (parent.type === "Property") {
      const key = propertyName(parent);
      if (MEDIA_KEYS.test(key ?? "") || MEDIA_GROUPS.test(key ?? "")) return true;
    }
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier" && MEDIA_KEYS.test(parent.id.name))
      return true;
    if (
      parent.type === "AssignmentExpression" &&
      parent.right === current &&
      isMediaAssignment(parent.left, scope, analysis)
    )
      return true;
    if (
      parent.type === "CallExpression" &&
      parent.arguments[1] === current &&
      parent.callee.type === "Identifier" &&
      parent.callee.name === "setLocalVar" &&
      !resolveBinding(scope, "setLocalVar")
    ) {
      const path = parent.arguments[0];
      const prefix = path?.type === "TemplateLiteral" ? path.quasis[0]?.value.cooked : path?.value;
      const suffix = path?.type === "TemplateLiteral" ? path.quasis.at(-1)?.value.cooked : path?.value;
      if (typeof prefix === "string" && prefix.startsWith("status.externalAvatars.") && suffix?.endsWith(".url"))
        return true;
    }
    if (
      [
        "CallExpression",
        "NewExpression",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "FunctionDeclaration",
      ].includes(parent.type)
    )
      break;
    current = parent;
  }
  return false;
}

function isMediaAssignment(target, scope, analysis) {
  const key = propertyName(target);
  if (MEDIA_KEYS.test(key ?? "") || (target.type === "Identifier" && MEDIA_KEYS.test(target.name))) return true;
  if (key !== "src") return false;
  if (target.object.type === "Identifier" && /^(?:img|image|video|avatar|poster)$/i.test(target.object.name))
    return true;
  const binding = target.object.type === "Identifier" ? resolveBinding(scope, target.object.name)?.[0] : null;
  const declaration = binding
    ? analysis.nodes.find((item) => item.node.type === "VariableDeclarator" && item.node.id === binding.node)
    : null;
  const init = declaration?.node.init;
  return (
    init?.type === "CallExpression" &&
    propertyName(init.callee) === "createElement" &&
    ["img", "video", "source"].includes(init.arguments[0]?.value)
  );
}

function isCharInfoGalleryMapCall(node) {
  if (node?.type !== "CallExpression") return false;
  const callee = node.callee?.type === "ChainExpression" ? node.callee.expression : node.callee;
  if (callee?.type !== "MemberExpression" || propertyName(callee) !== "map") return false;
  const gallery = callee.object;
  const callback = node.arguments?.[0];
  return (
    gallery?.type === "MemberExpression" &&
    propertyName(gallery) === "gallery" &&
    gallery.object?.type === "Identifier" &&
    gallery.object.name === "profile" &&
    callback?.type === "ArrowFunctionExpression" &&
    callback.params?.length === 1 &&
    callback.params[0]?.type === "Identifier" &&
    callback.params[0].name === "image"
  );
}

export function isGeneratedCharInfoMediaNode(node, parentByNode) {
  if (isCharInfoGalleryMapCall(node)) return true;
  if (
    node?.type !== "MemberExpression" ||
    node.object?.type !== "Identifier" ||
    node.object.name !== "image" ||
    !["sources", "thumbnail"].includes(propertyName(node))
  )
    return false;
  let current = node;
  while (current) {
    const parent = parentByNode.get(current);
    if (!parent) return false;
    if (parent.type === "ArrowFunctionExpression")
      return (
        parent.params?.[0]?.type === "Identifier" &&
        parent.params[0].name === "image" &&
        isCharInfoGalleryMapCall(parentByNode.get(parent)) &&
        parentByNode.get(parent)?.arguments?.[0] === parent
      );
    if (["FunctionExpression", "FunctionDeclaration"].includes(parent.type)) return false;
    current = parent;
  }
  return false;
}

function staticCollectionValues(node, analysis, scope, visited, evidence) {
  const binding = resolveBinding(scope, node.object.name)?.[0];
  if (binding?.kind !== "const") return null;
  const declaration = analysis.nodes.find(
    (item) => item.node.type === "VariableDeclarator" && item.node.id === binding.node,
  );
  if (!declaration) return null;
  // A complete literal candidate set stops being proof if the collection is
  // mutated through a method, passed to unknown code, or aliased elsewhere.
  const parents = new WeakMap(analysis.nodes.map((item) => [item.node, item.parent]));
  const escaped = analysis.nodes.some((item) => {
    const reference = item.node,
      parent = item.parent;
    if (
      reference.type !== "Identifier" ||
      resolveBinding(item.scope, reference.name)?.[0] !== binding ||
      reference === binding.node
    )
      return false;
    if (parent?.type !== "MemberExpression" || parent.object !== reference) return true;
    const consumer = parents.get(parent);
    return (
      (consumer?.type === "CallExpression" && consumer.callee === parent) ||
      (consumer?.type === "UnaryExpression" && consumer.operator === "delete")
    );
  });
  if (escaped) return null;
  const mutated = analysis.nodes.some(
    (item) =>
      ["AssignmentExpression", "UpdateExpression"].includes(item.node.type) &&
      (() => {
        let target = item.node.left ?? item.node.argument;
        while (target?.type === "MemberExpression") target = target.object;
        return target?.type === "Identifier" && resolveBinding(item.scope, target.name)?.[0] === binding;
      })(),
  );
  if (mutated) return null;
  const init = declaration.node.init,
    name = propertyName(node);
  if (
    init?.type === "ObjectExpression" &&
    init.properties.some((item) => item.type !== "Property" || item.kind !== "init" || !propertyName(item))
  )
    return null;
  const values =
    init?.type === "ObjectExpression"
      ? init.properties.filter((item) => !name || propertyName(item) === name).map((item) => item.value)
      : init?.type === "ArrayExpression"
        ? init.elements
        : null;
  if (!values?.length) return null;
  const possible = values.map((value) => staticStringValues(value, analysis, declaration.scope, visited, evidence));
  return possible.every(Boolean) ? [...new Set(possible.flat())] : null;
}
