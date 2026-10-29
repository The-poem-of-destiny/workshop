import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-api";

const worker = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(worker, "src");
const data = path.join(src, "data");
const storage = path.join(src, "storage");
const index = path.join(src, "index.ts");
const client = path.join(src, "data-client.ts");
const contracts = path.join(data, "contracts.ts");
const configPath = path.join(worker, "tsconfig.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  console.error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  process.exit(1);
}
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, worker);
if (config.errors.length) {
  for (const error of config.errors) console.error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  process.exit(1);
}
const files = ts.sys.readDirectory(src, [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"], undefined, ["**/*"]);
const program = ts.createProgram([...files, ...config.fileNames.filter((file) => file.endsWith(".d.ts"))], {
  ...config.options,
  noEmit: true,
});
const checker = program.getTypeChecker();
const moduleHost = ts.createCompilerHost(config.options, true);
const diagnostics = [];
const inside = (file, directory) => file === directory || file.startsWith(`${directory}${path.sep}`);
const normalize = (file) => path.normalize(path.resolve(file));
const sdkName = (name) => /^(?:D1|R2)[A-Z]/.test(name);

function report(node, message) {
  const source = node.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  diagnostics.push(`${path.relative(worker, source.fileName)}:${line + 1}:${character + 1}: ${message}`);
}

function moduleTarget(specifier, source) {
  const resolved = ts.resolveModuleName(specifier, source.fileName, config.options, moduleHost).resolvedModule;
  return resolved && normalize(resolved.resolvedFileName);
}

function typeOnlyImport(node) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return (
    !clause.name &&
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function typeOnlyExport(node) {
  return (
    node.isTypeOnly ||
    (node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.every((element) => element.isTypeOnly))
  );
}

function entrypointExport(node, source, target) {
  if (
    normalize(source.fileName) !== index ||
    !ts.isExportDeclaration(node) ||
    !node.exportClause ||
    !ts.isNamedExports(node.exportClause) ||
    node.isTypeOnly
  )
    return false;
  const allowed =
    target === path.join(data, "service.ts")
      ? "DataService"
      : target === path.join(data, "cached-reads.ts")
        ? "CachedReads"
        : undefined;
  return (
    !!allowed &&
    node.exportClause.elements.length === 1 &&
    node.exportClause.elements[0].name.text === allowed &&
    (!node.exportClause.elements[0].propertyName || node.exportClause.elements[0].propertyName.text === allowed)
  );
}

// Resolve module specifiers through the project's TypeScript configuration, including paths aliases.
function checkModule(node, source, specifier) {
  const target = moduleTarget(specifier, source);
  if (!target) {
    if (specifier.startsWith(".")) report(node, `cannot resolve module '${specifier}'`);
    return;
  }
  if (inside(target, storage)) {
    report(node, `storage implementation is not accessible here: '${specifier}'`);
  } else if (inside(target, data)) {
    if (target === contracts) {
      const typeOnly =
        ts.isImportTypeNode(node) ||
        (ts.isImportDeclaration(node)
          ? typeOnlyImport(node)
          : ts.isExportDeclaration(node)
            ? typeOnlyExport(node)
            : false);
      if (!typeOnly) report(node, "data contracts may only be imported or re-exported as types");
    } else if (!entrypointExport(node, source, target)) {
      report(node, `data implementation is not accessible here: '${specifier}'`);
    }
  }
}

function staticName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ? node.text : undefined;
}

function forbiddenType(type, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);
  const symbol = type.getSymbol();
  if ([symbol, type.aliasSymbol].some((item) => item && (sdkName(item.getName()) || item.getName() === "DataEnv")))
    return true;
  // Namespace type arguments name the server-side class, not an exposed binding value.
  if (
    symbol?.getName() === "DurableObjectNamespace" &&
    symbol
      .getDeclarations()
      ?.every((declaration) =>
        normalize(declaration.getSourceFile().fileName).includes(`${path.sep}node_modules${path.sep}`),
      )
  )
    return false;
  if (type.isUnionOrIntersection() && type.types.some((part) => forbiddenType(part, seen))) return true;
  if (type.aliasTypeArguments?.some((part) => forbiddenType(part, seen))) return true;
  if (
    type.objectFlags & ts.ObjectFlags.Reference &&
    checker.getTypeArguments(type).some((part) => forbiddenType(part, seen))
  )
    return true;
  const declarations = symbol?.getDeclarations() || [];
  // Do not expand platform/library object graphs; their relevant type names were checked above.
  if (
    declarations.length &&
    declarations.every((declaration) => {
      const name = normalize(declaration.getSourceFile().fileName);
      return (
        name.includes(`${path.sep}node_modules${path.sep}`) ||
        name.includes(`${path.sep}typescript${path.sep}lib${path.sep}`)
      );
    })
  )
    return false;
  for (const property of checker.getPropertiesOfType(type)) {
    if (property.getName() === "DB" || property.getName() === "R2") return true;
    const declaration = property.valueDeclaration || property.declarations?.[0];
    if (declaration && forbiddenType(checker.getTypeOfSymbolAtLocation(property, declaration), seen)) return true;
  }
  for (const signature of checker.getSignaturesOfType(type, ts.SignatureKind.Call)) {
    if (forbiddenType(checker.getReturnTypeOfSignature(signature), seen)) return true;
    for (const parameter of signature.parameters) {
      const declaration = parameter.valueDeclaration || parameter.declarations?.[0];
      if (declaration && forbiddenType(checker.getTypeOfSymbolAtLocation(parameter, declaration), seen)) return true;
    }
  }
  return false;
}

function scan(source) {
  const filename = normalize(source.fileName);
  const isContracts = filename === contracts;
  const outer = inside(filename, src) && !inside(filename, data) && !inside(filename, storage);
  const projectDependency =
    !inside(filename, src) && !filename.includes(`${path.sep}node_modules${path.sep}`) && !source.isDeclarationFile;
  if (!outer && !isContracts && !projectDependency) return;

  function visit(node) {
    if (outer || isContracts || projectDependency) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        checkModule(node, source, node.moduleSpecifier.text);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        checkModule(node, source, node.moduleReference.expression.text);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        checkModule(node, source, node.argument.literal.text);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        if (node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]))
          checkModule(node, source, node.arguments[0].text);
        else report(node, "dynamic module specifiers are not permitted at the data boundary");
      }
    }
    if (outer) {
      if (ts.isPropertyAccessExpression(node) && (node.name.text === "DB" || node.name.text === "R2")) {
        report(node, `binding access '${node.name.text}' is restricted to the data region`);
      }
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ["DB", "R2"].includes(staticName(node.argumentExpression))
      ) {
        report(node, "binding access is restricted to the data region");
      }
      if (ts.isBindingElement(node) && ["DB", "R2"].includes(staticName(node.propertyName || node.name))) {
        report(node, "binding destructuring is restricted to the data region");
      }
      if (
        (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
        node.name &&
        ["DB", "R2"].includes(staticName(node.name))
      ) {
        report(node, "storage binding declarations are restricted to the data region");
      }
      if (
        ((ts.isTypeReferenceNode(node) &&
          !(ts.isIndexedAccessTypeNode(node.parent) && node.parent.objectType === node)) ||
          ts.isIndexedAccessTypeNode(node)) &&
        forbiddenType(checker.getTypeFromTypeNode(node))
      ) {
        report(node, "storage-bearing types are restricted to the data region");
      }
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        if (node.type.kind === ts.SyntaxKind.AnyKeyword || forbiddenType(checker.getTypeFromTypeNode(node.type))) {
          report(node, "casts to any or storage-bearing types are not permitted outside the data region");
        }
      }
    }
    if ((outer || isContracts) && ts.isIdentifier(node) && (sdkName(node.text) || node.text === "DataEnv")) {
      if (
        ts.isTypeReferenceNode(node.parent) ||
        ts.isExpressionWithTypeArguments(node.parent) ||
        ts.isImportSpecifier(node.parent) ||
        ts.isExportSpecifier(node.parent)
      ) {
        report(node, "storage binding types are restricted to the data implementation");
      }
    }
    if (isContracts && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))) {
      if (forbiddenType(checker.getTypeAtLocation(node)))
        report(node, "data contracts must not contain storage binding types");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  if (filename === client) {
    const module = checker.getSymbolAtLocation(source);
    if (module) {
      for (const exported of checker.getExportsOfModule(module)) {
        const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
        const type = declaration && checker.getTypeOfSymbolAtLocation(symbol, declaration);
        const isServiceClient =
          exported.getName() === "dataClient" && declaration && ts.isFunctionDeclaration(declaration);
        const signatures = type && checker.getSignaturesOfType(type, ts.SignatureKind.Call);
        const service = isServiceClient && signatures?.length === 1 && checker.getReturnTypeOfSignature(signatures[0]);
        // A loopback stub's generic argument is the server class, not a value exposed by RPC.
        // Inspect the projected public RPC members instead of its internal brand/type arguments.
        const exposesStorage = service
          ? checker.getPropertiesOfType(service).some((property) => {
              const member = property.valueDeclaration || property.declarations?.[0];
              if (!member || property.getName().startsWith("__@")) return false;
              return forbiddenType(checker.getTypeOfSymbolAtLocation(property, member));
            })
          : type && forbiddenType(type);
        if (declaration && exposesStorage) {
          report(declaration, `data-client export '${exported.getName()}' exposes a storage-bearing type`);
        }
      }
    }
  }
}

for (const source of program.getSourceFiles()) scan(source);
if (diagnostics.length) {
  console.error(diagnostics.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Data boundary check passed.");
}
