import { classifyDynamicMediaCandidates, LINK_TRUST } from "../external-links/policy.mjs";
import {
  expressionEvidence,
  isGeneratedCharInfoMediaNode,
  mediaContext,
  navigationTarget,
  networkCapability,
  propertyName,
  staticStringValues,
} from "./link-expressions.mjs";
import { directUrls, external } from "./link-source.mjs";
import { inspectCharInfoManagedV2Block } from "./policy-config.mjs";
import { buildScopes, resolveBinding } from "./scope.mjs";

function collectAstMediaTargets(context) {
  const { unit, analysis, parents, mediaNodes, source, addTarget, hints } = context;
  for (const { node, scope, parent } of analysis.nodes) {
    if (
      !unit.sourceMap.isOriginal(node.start) ||
      !parent ||
      !(
        (parent.type === "AssignmentExpression" && parent.right === node) ||
        (parent.type === "Property" && parent.value === node) ||
        (parent.type === "VariableDeclarator" && parent.init === node)
      ) ||
      !mediaContext(node, scope, parents, analysis)
    )
      continue;
    const evidence = new Set(),
      values = staticStringValues(node, analysis, scope, new Set(), evidence);
    if (values) {
      for (const proven of evidence) mediaNodes.add(proven);
      for (const value of values)
        addTarget(value, unit.sourceMap.map(node.start), "media", "resource", expressionEvidence(node));
    } else if (
      !["ObjectExpression", "ArrayExpression", "Literal", "FunctionExpression", "ArrowFunctionExpression"].includes(
        node.type,
      ) &&
      !(node.type === "CallExpression" && propertyName(node.callee) === "createElement") &&
      !(
        node.type === "NewExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "Image" &&
        !resolveBinding(scope, "Image")
      )
    ) {
      reportDynamicMedia(node, unit, parents, source, hints);
    }
  }
}

function collectAstActionTargets(context) {
  const { unit, analysis, navigation, addTarget, hints, covered } = context;
  for (const { node, scope } of analysis.nodes) {
    if (!unit.sourceMap.isOriginal(node.start)) continue;
    collectNetworkCallTarget(node, scope, context);
    const target = navigationTarget(node, scope);
    if (!target) continue;
    navigation.add(node);
    const values = staticStringValues(target.argument, analysis, scope),
      index = unit.sourceMap.map(node.start),
      expression = expressionEvidence(node);
    covered.push({ start: unit.sourceMap.map(node.start), end: unit.sourceMap.map(node.end) });
    if (values) for (const value of values) addTarget(value, index, "navigation", target.action, expression);
    else
      hints.push({
        ruleId: "AH2",
        severity: "hint",
        title: "外部跳转目标需要人工确认",
        index,
        detail: "代码会尝试打开或跳转到运行时决定的位置。",
        suggestion: "请向审核员说明跳转目标及其用途；这条提示本身不代表违规。",
        extra: { riskEvidence: { action: target.action, usage: "navigation", target: "dynamic", expression } },
      });
  }
}

function collectNetworkCallTarget(node, scope, { unit, analysis, networkCalls, addTarget, covered }) {
  if (!["CallExpression", "NewExpression"].includes(node.type)) return;
  const callee = node.callee.type === "ChainExpression" ? node.callee.expression : node.callee;
  const method = propertyName(callee);
  const network =
    networkCapability(callee, analysis, scope) ||
    (["call", "apply"].includes(method) ? networkCapability(callee.object, analysis, scope) : null);
  if (!["fetch", "WebSocket", "EventSource"].includes(network)) return;
  networkCalls.add(node);
  const argument =
    method === "call" ? node.arguments[1] : method === "apply" ? node.arguments[1]?.elements?.[0] : node.arguments[0];
  const values = staticStringValues(argument, analysis, scope);
  if (values)
    for (const value of values)
      addTarget(value, unit.sourceMap.map(node.start), "network", network, expressionEvidence(node));
  covered.push({ start: unit.sourceMap.map(node.start), end: unit.sourceMap.map(node.end) });
}

function collectAstResourceTargets(context) {
  const { unit, analysis, parents, navigation, networkCalls, mediaNodes, source, addTarget, hints, covered } = context;
  for (const { node, scope } of analysis.nodes) {
    if (!isResourceExpression(node, unit, parents)) continue;
    let usage = mediaContext(node, scope, parents, analysis) || mediaNodes.has(node) ? "media" : "unknown";
    for (let ancestor = parents.get(node); ancestor; ancestor = parents.get(ancestor)) {
      if (navigation.has(ancestor)) {
        usage = "navigation";
        break;
      }
      if (networkCalls.has(ancestor)) {
        usage = "network";
        break;
      }
    }
    if (usage === "navigation" || usage === "network") continue;
    const values = staticStringValues(node, analysis, scope),
      index = unit.sourceMap.map(node.start);
    covered.push({ start: index, end: unit.sourceMap.map(node.end) });
    if (
      !values &&
      ["TemplateLiteral", "BinaryExpression"].includes(node.type) &&
      /(?:https?:)?\/\//.test(unit.code.slice(node.start, node.end))
    )
      hints.push({
        ruleId: "U5",
        severity: "warn",
        title: "远程目标由运行时内容决定",
        index,
        detail: source.slice(index, unit.sourceMap.map(node.end)),
        suggestion: "请提供所有可能访问的目标，或向审核员说明动态目标的来源和用途。",
        extra: {
          riskEvidence: { action: "resource", usage, target: "dynamic", expression: expressionEvidence(node) },
        },
      });
    if (values)
      for (const value of values) {
        if (external(value)) addTarget(value, index, usage, "resource", expressionEvidence(node));
        else
          for (const url of directUrls(value))
            addTarget(url.url, index + url.index, usage, "resource", expressionEvidence(node));
      }
  }
}

export function collectAstLinkTargets(unit, context) {
  const analysis = buildScopes(unit);
  const state = {
    ...context,
    unit,
    analysis,
    parents: new WeakMap(analysis.nodes.map((item) => [item.node, item.parent])),
    navigation: new Set(),
    networkCalls: new Set(),
    mediaNodes: new Set(),
  };
  collectAstMediaTargets(state);
  collectAstActionTargets(state);
  collectAstResourceTargets(state);
}

function isResourceExpression(node, unit, parents) {
  if (
    !unit.sourceMap.isOriginal(node.start) ||
    !["Literal", "TemplateLiteral", "BinaryExpression", "Identifier", "MemberExpression"].includes(node.type)
  )
    return false;
  const parent = parents.get(node);
  if (
    ["Identifier", "MemberExpression"].includes(node.type) &&
    ((["IfStatement", "ConditionalExpression", "WhileStatement", "DoWhileStatement", "ForStatement"].includes(
      parent?.type,
    ) &&
      parent.test === node) ||
      (parent?.type === "LogicalExpression" && parent.left === node) ||
      (parent?.type === "UnaryExpression" &&
        unit.sourceMap.isOriginal(parent.start) &&
        ["!", "typeof", "void"].includes(parent.operator)))
  )
    return false;
  if (
    node.type === "Identifier" &&
    ((parent?.type === "VariableDeclarator" && parent.id === node) ||
      (parent?.type === "MemberExpression" && !parent.computed && parent.property === node) ||
      (parent?.type === "Property" && !parent.computed && parent.key === node && !parent.shorthand) ||
      (parent?.type === "AssignmentExpression" && parent.left === node))
  )
    return false;
  if (node.type === "MemberExpression" && parent?.type === "AssignmentExpression" && parent.left === node) return false;
  if ((parent?.type === "BinaryExpression" && parent.operator === "+") || parent?.type === "TemplateLiteral")
    return false;
  return true;
}

function reportDynamicMedia(node, unit, parents, source, hints) {
  const index = unit.sourceMap.map(node.start);
  const charInfoBlock = inspectCharInfoManagedV2Block(source, index);
  const generated = Boolean(charInfoBlock) && isGeneratedCharInfoMediaNode(node, parents);
  const candidates = generated ? charInfoBlock.mediaUrls : [];
  if (generated && classifyDynamicMediaCandidates(candidates).trust === LINK_TRUST.TRUSTED) return;
  hints.push({
    ruleId: "AH2",
    severity: "hint",
    title: "媒体来源需要人工确认",
    index,
    detail: "最终图片或视频地址由运行时内容决定，自动检查无法确定实际会加载哪个地址。",
    suggestion: candidates.length
      ? "请核对下方 URL 候选与这段媒体逻辑的实际用途；如果候选与实际地址不同，请 Creator 说明最终来源。"
      : "当前条目没有可直接读出的 URL。请 Creator 提供实际图片/视频地址或来源规则后再确认。",
    extra: {
      riskEvidence: {
        action: "resource",
        usage: "media",
        target: "dynamic",
        expression: expressionEvidence(node),
        candidates,
      },
    },
  });
}
