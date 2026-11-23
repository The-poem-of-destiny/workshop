// Bindings belong to actual JavaScript scopes; the parser's EJS wrapper is excluded.
export function patternTargets(pattern) {
  const targets = [];
  const stack = [pattern];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    switch (current.type) {
      case "ChainExpression":
        stack.push(current.expression);
        break;
      case "Identifier":
      case "MemberExpression":
        targets.push(current);
        break;
      case "RestElement":
        stack.push(current.argument);
        break;
      case "AssignmentPattern":
        stack.push(current.left);
        break;
      case "ArrayPattern":
        for (let i = current.elements.length - 1; i >= 0; i--) stack.push(current.elements[i]);
        break;
      case "ObjectPattern":
        for (let i = current.properties.length - 1; i >= 0; i--) {
          const property = current.properties[i];
          stack.push(property.type === "RestElement" ? property.argument : property.value);
        }
        break;
    }
  }
  return targets;
}

function astChildren(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === "string") children.push(child);
    } else if (value && typeof value.type === "string") children.push(value);
  }
  return children;
}

const childScope = (kind, parent) => ({ kind, parent, bindings: new Map() });

function bindPattern(scope, target, kind) {
  for (const node of patternTargets(target)) {
    if (node.type !== "Identifier") continue;
    if (!scope.bindings.has(node.name)) scope.bindings.set(node.name, []);
    scope.bindings.get(node.name).push({ name: node.name, node, kind });
  }
}

function enclosingVarScope(scope) {
  while (!["root", "function-body", "static"].includes(scope.kind)) scope = scope.parent;
  return scope;
}

function scheduleFunctionNode(node, scope, { namedDeclarations, stack, pushList }) {
  if (node.type === "FunctionDeclaration" && node.id) {
    bindPattern(scope, node.id, "function");
    namedDeclarations.push({ node, scope, kind: "function", binding: node.id });
  }
  const params = childScope("function-params", scope);
  if (node.type === "FunctionExpression" && node.id) bindPattern(params, node.id, "function-name");
  for (const parameter of node.params) bindPattern(params, parameter, "parameter");
  const body = childScope("function-body", params);
  stack.push({
    node: node.body,
    scope: body,
    parent: node,
    directBlock: node.body.type === "BlockStatement",
  });
  pushList(node.params, params, node);
}

function scheduleClassNode(node, scope, { namedDeclarations, stack }) {
  if (node.type === "ClassDeclaration" && node.id) {
    bindPattern(scope, node.id, "class");
    namedDeclarations.push({ node, scope, kind: "class", binding: node.id });
  }
  const inner = childScope("class", scope);
  if (node.id) bindPattern(inner, node.id, "class-name");
  if (node.body) stack.push({ node: node.body, scope: inner, parent: node, directBlock: false });
  if (node.superClass) stack.push({ node: node.superClass, scope: inner, parent: node, directBlock: false });
}

function scheduleBlockOrSwitchNode(node, scope, { stack }) {
  const inner = childScope(node.type === "StaticBlock" ? "static" : "block", scope);
  const children = astChildren(node);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (node.type === "SwitchStatement" && child === node.discriminant) continue;
    stack.push({ node: child, scope: inner, parent: node, directBlock: false });
  }
  // Switch discriminants are evaluated outside the switch's lexical scope.
  if (node.type === "SwitchStatement" && node.discriminant) {
    stack.push({ node: node.discriminant, scope, parent: node, directBlock: false });
  }
}

function scheduleSpecialNode(node, scope, ctx) {
  switch (node.type) {
    case "ImportDeclaration":
      for (const specifier of node.specifiers) bindPattern(scope, specifier.local, "import");
      return true;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      scheduleFunctionNode(node, scope, ctx);
      return true;
    case "ClassDeclaration":
    case "ClassExpression":
      scheduleClassNode(node, scope, ctx);
      return true;
    case "VariableDeclaration": {
      const targetScope = node.kind === "var" ? enclosingVarScope(scope) : scope;
      const bindings = node.declarations
        .flatMap((declaration) => patternTargets(declaration.id))
        .filter((binding) => binding.type === "Identifier");
      for (const declaration of node.declarations) bindPattern(targetScope, declaration.id, node.kind);
      ctx.declarations.push({ node, scope, targetScope, bindings });
      return false;
    }
    case "BlockStatement":
    case "SwitchStatement":
    case "StaticBlock":
      scheduleBlockOrSwitchNode(node, scope, ctx);
      return true;
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
      ctx.pushList(astChildren(node), childScope("loop", scope), node);
      return true;
    case "CatchClause": {
      const inner = childScope("catch", scope);
      bindPattern(inner, node.param, "catch");
      if (node.body) ctx.stack.push({ node: node.body, scope: inner, parent: node, directBlock: false });
      if (node.param) ctx.stack.push({ node: node.param, scope: inner, parent: node, directBlock: false });
      return true;
    }
    case "WithStatement": {
      const inner = childScope("with", scope);
      if (node.body) ctx.stack.push({ node: node.body, scope: inner, parent: node, directBlock: false });
      if (node.object) ctx.stack.push({ node: node.object, scope, parent: node, directBlock: false });
      return true;
    }
    default:
      return false;
  }
}

export function buildScopes(unit) {
  const root = childScope("root", null);
  const nodes = [],
    declarations = [],
    namedDeclarations = [],
    stack = [];
  const nodeScopes = new WeakMap();
  const pushList = (list, scope, parent) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const child = list[i];
      if (child) stack.push({ node: child, scope, parent, directBlock: false });
    }
  };
  const ctx = { declarations, namedDeclarations, stack, pushList };

  if (unit.ast) stack.push({ node: unit.ast, scope: root, parent: null, directBlock: false });
  while (stack.length > 0) {
    const { node, scope, parent, directBlock } = stack.pop();
    if (!node) continue;
    if (node === unit.wrapperFunction) {
      pushList(node.body.body, root, node.body);
      continue;
    }
    nodeScopes.set(node, scope);
    nodes.push({ node, scope, parent });
    if (directBlock) {
      pushList(node.body, scope, node);
      continue;
    }
    if (!scheduleSpecialNode(node, scope, ctx)) {
      pushList(astChildren(node), scope, node);
    }
  }
  return { root, nodes, nodeScopes, declarations, namedDeclarations };
}

export function resolveBinding(scope, name, { stopAtWith = true } = {}) {
  for (let current = scope; current; current = current.parent) {
    if (stopAtWith && current.kind === "with") return null;
    if (current.bindings.has(name)) return current.bindings.get(name);
  }
  return null;
}

export function isFunctionLocal(scope) {
  for (let current = scope; current; current = current.parent) {
    if (["function-params", "function-body", "static"].includes(current.kind)) return true;
  }
  return false;
}
