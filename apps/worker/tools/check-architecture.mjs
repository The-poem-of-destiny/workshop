import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const policy = {
  "apps/worker": ["packages/contracts", "packages/domain", "packages/content"],
  "apps/tavern-client": ["packages/contracts"],
  "packages/contracts": ["packages/domain"],
  "packages/domain": [],
  "packages/content": [],
};
const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const inside = (file, dir) => file === dir || file.startsWith(`${dir}/`);
const ownerOf = (file) => Object.keys(policy).find((dir) => inside(file, dir));

export function checkArchitecture(base = root) {
  const errors = [];
  const names = new Map();
  for (const dir of Object.keys(policy)) {
    const manifest = JSON.parse(readFileSync(path.join(base, dir, "package.json"), "utf8"));
    if (!manifest.name || names.has(manifest.name)) errors.push(`${dir}: missing or duplicate package name`);
    names.set(manifest.name, dir);
  }
  for (const dir of Object.keys(policy)) {
    const manifest = JSON.parse(readFileSync(path.join(base, dir, "package.json"), "utf8"));
    for (const section of sections) {
      for (const [name, version] of Object.entries(manifest[section] || {})) {
        const target = names.get(name);
        if (target && target !== dir && !policy[dir].includes(target)) {
          errors.push(`${dir}/package.json: forbidden ${section} dependency on ${name}`);
        } else if (!target && (name.startsWith("@workshop/") || version.startsWith("workspace:"))) {
          errors.push(`${dir}/package.json: unknown workspace dependency ${name}`);
        }
      }
    }
  }
  for (const dir of Object.keys(policy)) {
    const roots = [path.join(base, dir, "src")];
    if (dir === "apps/worker") roots.push(path.join(base, dir, "web/src"));
    for (const sourceRoot of roots.filter(existsSync)) {
      const files = ts.sys.readDirectory(
        sourceRoot,
        [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"],
        ["**/vendor/**"],
        ["**/*"],
      );
      for (const file of files) scanFile(base, dir, file, names, errors);
    }
  }
  return errors;
}
function scanFile(base, dir, file, names, errors) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const relative = path.relative(base, file).split(path.sep).join("/");
  const configPath = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
  const config = configPath && ts.readConfigFile(configPath, ts.sys.readFile);
  const options =
    config && !config.error
      ? ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options
      : { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true };
  function report(node, message) {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    errors.push(`${relative}:${line + 1}:${character + 1}: ${message}`);
  }
  function inspect(node, specifier) {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    const absolute =
      resolved?.resolvedFileName || (specifier.startsWith(".") && path.resolve(path.dirname(file), specifier));
    let target = absolute ? path.relative(base, absolute).split(path.sep).join("/") : undefined;
    if (!specifier.startsWith(".")) {
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      target = target || names.get(name);
      if (!target && name.startsWith("@workshop/")) report(node, `unknown workspace import '${specifier}'`);
    }
    if (!target) return;
    const owner = ownerOf(target);
    if (owner && owner !== dir && !policy[dir].includes(owner)) report(node, `forbidden dependency on '${specifier}'`);
    if (inside(relative, "apps/worker/web/src") && (target === "apps/worker" || inside(target, "apps/worker/src"))) {
      report(node, `Web cannot import Worker implementation '${specifier}'`);
    }
    if (inside(relative, "apps/worker/src/storage") && inside(target, "apps/worker/src/data")) {
      const typeOnly =
        (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && node.isTypeOnly) ||
        ts.isImportTypeNode(node);
      if (target !== "apps/worker/src/data/contracts.ts" || !typeOnly)
        report(node, `storage may only import data contracts as types: '${specifier}'`);
    }
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      inspect(node, node.moduleSpecifier.text);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      inspect(node, node.argument.literal.text);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    )
      inspect(node, node.moduleReference.expression.text);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]))
        inspect(node, node.arguments[0].text);
      else report(node, "dynamic module specifiers cannot be checked against architecture boundaries");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkArchitecture();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("architecture check ok");
}
