import ts from 'typescript';
import path from 'path';
import { ROOT_DIR } from '../../utils/paths';

let cachedProgram: ts.Program | null = null;

export const getServerProgram = (): ts.Program => {
  if (cachedProgram) return cachedProgram;

  const tsconfigPath = ts.findConfigFile(ROOT_DIR, ts.sys.fileExists, 'tsconfig.server.json');
  if (!tsconfigPath) throw new Error('[TypeProgram] tsconfig.server.json not found');

  const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

  cachedProgram = ts.createProgram(fileNames, options);
  return cachedProgram;
};

export const invalidateProgramCache = (): void => {
  cachedProgram = null;
};

const DEPTH_LIMIT = 12;

export interface UnresolvedTypeSymbol {
  name: string;
  sourceFile?: string;
  importPath?: string;
}

export interface ExpandedTypeResult {
  text: string;
  unresolvedSymbols: UnresolvedTypeSymbol[];
}

const JSON_TYPE_NAMES = new Set([
  'Json',
  'JsonValue',
  'JsonObject',
  'JsonArray',
  'InputJsonValue',
  'InputJsonObject',
  'InputJsonArray',
]);

// Generic containers we never recursively expand (their internal shape is irrelevant to API types)
const SKIP_EXPANSION = new Set([
  'Promise', 'Map', 'WeakMap', 'Set', 'WeakSet',
  'Error', 'Date', 'RegExp', 'Buffer', 'ArrayBuffer', 'ReadonlyArray',
]);

const isJsonLikeType = (type: ts.Type, checker: ts.TypeChecker): boolean => {
  const symbolName = type.symbol?.name || '';
  const aliasName = type.aliasSymbol?.name || '';

  if (JSON_TYPE_NAMES.has(symbolName) || JSON_TYPE_NAMES.has(aliasName)) return true;

  const rendered = checker.typeToString(type);
  return /(\bPrisma\.)?(Input)?Json(Value|Object|Array)\b/.test(rendered);
};

const getLiteralTypeFromExpression = (
  expression: ts.Expression,
  checker: ts.TypeChecker,
  depth: number,
): string | null => {
  if (ts.isParenthesizedExpression(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return getLiteralTypeFromExpression(expression.expression, checker, depth);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (expression.kind === ts.SyntaxKind.NullKeyword) return 'null';

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return `'${expression.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }

  if (ts.isNumericLiteral(expression)) {
    return expression.text;
  }

  if (
    ts.isPrefixUnaryExpression(expression)
    && expression.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(expression.operand)
  ) {
    return `-${expression.operand.text}`;
  }

  if (ts.isIdentifier(expression)) {
    const identifierType = checker.getTypeAtLocation(expression);
    const isLiteralType = (identifierType.flags & (
      ts.TypeFlags.StringLiteral
      | ts.TypeFlags.NumberLiteral
      | ts.TypeFlags.BooleanLiteral
      | ts.TypeFlags.Null
      | ts.TypeFlags.Undefined
    )) !== 0;

    if (isLiteralType || identifierType.isUnion()) {
      const expanded = expandTypeDetailed(identifierType, checker, depth).text;
      if (expanded.includes("'") || /\btrue\b|\bfalse\b|\bnull\b|\bundefined\b/.test(expanded)) {
        return expanded;
      }
    }
  }

  return null;
};

const getLiteralTypeFromPropertySymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  depth: number,
): string | null => {
  const declarations = symbol.declarations ?? [];

  for (const declaration of declarations) {
    if (ts.isPropertyAssignment(declaration)) {
      const literal = getLiteralTypeFromExpression(declaration.initializer, checker, depth);
      if (literal) return literal;
    }

    if (ts.isShorthandPropertyAssignment(declaration)) {
      const literal = getLiteralTypeFromExpression(declaration.name, checker, depth);
      if (literal) return literal;
    }
  }

  return null;
};

const normalizeImportPath = (targetFilePath: string): string => {
  const fromDir = path.join(ROOT_DIR, 'src', '_sockets');
  const from = fromDir.replace(/\\/g, '/');
  const to = targetFilePath.replace(/\\/g, '/');

  const normalized = path.posix.relative(from, to).replace(/\\/g, '/');
  const withoutExtension = normalized.replace(/(\.d)?\.(ts|tsx|js|jsx)$/i, '');

  if (withoutExtension.startsWith('.')) return withoutExtension;
  return `./${withoutExtension}`;
};

const mergeUnresolvedSymbols = (
  left: UnresolvedTypeSymbol[],
  right: UnresolvedTypeSymbol[],
): UnresolvedTypeSymbol[] => {
  const merged = [...left];
  const seen = new Set(merged.map((symbol) => `${symbol.name}|${symbol.importPath ?? ''}|${symbol.sourceFile ?? ''}`));
  for (const symbol of right) {
    const key = `${symbol.name}|${symbol.importPath ?? ''}|${symbol.sourceFile ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(symbol);
  }
  return merged;
};

const collectTypeSymbolFallback = (type: ts.Type): UnresolvedTypeSymbol[] => {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  if (!symbol) return [];

  const name = symbol.getName();
  if (!name || name.startsWith('__')) return [];

  const declaration = symbol.declarations?.[0];
  if (!declaration) return [{ name }];

  const sourceFile = declaration.getSourceFile().fileName;
  if (!sourceFile || sourceFile.includes('/node_modules/') || sourceFile.includes('\\node_modules\\')) {
    return [{ name }];
  }

  return [{
    name,
    sourceFile,
    importPath: normalizeImportPath(sourceFile),
  }];
};

interface ExpandState {
  stackTypeIds: Set<number>;
}

// Recursively expand a TypeScript type to an inline type string with no named references.
// The result is self-contained and requires no imports.
export const expandTypeDetailed = (
  type: ts.Type,
  checker: ts.TypeChecker,
  depth = 0,
  state?: ExpandState,
): ExpandedTypeResult => {
  const expandState: ExpandState = state ?? { stackTypeIds: new Set<number>() };
  const typeId = (type as ts.Type & { id?: number }).id;

  if (typeId !== undefined) {
    if (expandState.stackTypeIds.has(typeId)) {
      return {
        text: checker.typeToString(type),
        unresolvedSymbols: collectTypeSymbolFallback(type),
      };
    }
    expandState.stackTypeIds.add(typeId);
  }

  try {
    if (depth > DEPTH_LIMIT) {
      return {
        text: checker.typeToString(type),
        unresolvedSymbols: collectTypeSymbolFallback(type),
      };
    }

    if (isJsonLikeType(type, checker)) return { text: 'JsonValue', unresolvedSymbols: [] };

    // String literals ('hello') — use single quotes for consistency with the codebase
    if (type.isStringLiteral()) return { text: `'${type.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, unresolvedSymbols: [] };

    // Number literals (42, 3.14)
    if (type.isNumberLiteral()) return { text: String(type.value), unresolvedSymbols: [] };

  // Primitives and special types (string, number, boolean, true, false, null, undefined, any, unknown, never, void)
    if (
      type.flags
      & (
        ts.TypeFlags.String
        | ts.TypeFlags.Number
        | ts.TypeFlags.Boolean
        | ts.TypeFlags.BooleanLiteral
        | ts.TypeFlags.Undefined
        | ts.TypeFlags.Null
        | ts.TypeFlags.Any
        | ts.TypeFlags.Unknown
        | ts.TypeFlags.Never
        | ts.TypeFlags.Void
      )
    ) {
      return { text: checker.typeToString(type), unresolvedSymbols: [] };
    }

  // Union types (A | B | C)
    if (type.isUnion()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.types.map((innerType) => {
      const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      return expanded.text;
    });
    return { text: expandedTypes.join(' | '), unresolvedSymbols };
    }

  // Intersection types (A & B)
    if (type.isIntersection()) {
    let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
    const expandedTypes = type.types.map((innerType) => {
      const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
      unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
      return expanded.text;
    });
    return { text: expandedTypes.join(' & '), unresolvedSymbols };
    }

  // Object types (interfaces, type literals, generic instances)
    if (type.flags & ts.TypeFlags.Object) {
    const objectType = type as ts.ObjectType;

    // Tuple types [A, B, C]
    if (objectType.objectFlags & ts.ObjectFlags.Tuple) {
      const typeArgs = checker.getTypeArguments(objectType as ts.TypeReference);
      let unresolvedSymbols: UnresolvedTypeSymbol[] = [];
      const tupleTypes = typeArgs.map((innerType) => {
        const expanded = expandTypeDetailed(innerType, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expanded.unresolvedSymbols);
        return expanded.text;
      });
      return { text: `[${tupleTypes.join(', ')}]`, unresolvedSymbols };
    }

    if (objectType.objectFlags & ts.ObjectFlags.Reference) {
      const refType = objectType as ts.TypeReference;
      const targetName = refType.target?.symbol?.name ?? '';

      // Array<T> / ReadonlyArray<T> → T[]
      if (targetName === 'Array' || targetName === 'ReadonlyArray') {
        const typeArgs = checker.getTypeArguments(refType);
        if (typeArgs.length > 0) {
          const expanded = expandTypeDetailed(typeArgs[0], checker, depth + 1, expandState);
          return {
            text: `${expanded.text}[]`,
            unresolvedSymbols: expanded.unresolvedSymbols,
          };
        }
      }

      // Known opaque containers — return as-is without expanding internals
      if (SKIP_EXPANSION.has(targetName)) {
        return { text: checker.typeToString(type), unresolvedSymbols: [] };
      }
    }

    // Known non-generic opaque containers (Date, Error, Buffer, etc.)
    const symbolName = type.symbol?.name || type.aliasSymbol?.name || '';
    if (SKIP_EXPANSION.has(symbolName)) {
      return { text: checker.typeToString(type), unresolvedSymbols: [] };
    }

    const props = checker.getPropertiesOfType(type);
    const indexInfos = checker.getIndexInfosOfType(type);

    if (props.length > 0 || indexInfos.length > 0) {
      const fields: string[] = [];
      let unresolvedSymbols: UnresolvedTypeSymbol[] = [];

      for (const prop of props) {
        const propType = checker.getTypeOfSymbol(prop);
        const literalType = getLiteralTypeFromPropertySymbol(prop, checker, depth + 1);
        const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

        if (literalType) {
          fields.push(`${prop.name}${isOptional ? '?' : ''}: ${literalType}`);
          continue;
        }

        const expandedProp = expandTypeDetailed(propType, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, expandedProp.unresolvedSymbols);
        fields.push(`${prop.name}${isOptional ? '?' : ''}: ${expandedProp.text}`);
      }

      for (const indexInfo of indexInfos) {
        const keyType = expandTypeDetailed(indexInfo.keyType, checker, depth + 1, expandState);
        const valueType = expandTypeDetailed(indexInfo.type, checker, depth + 1, expandState);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, keyType.unresolvedSymbols);
        unresolvedSymbols = mergeUnresolvedSymbols(unresolvedSymbols, valueType.unresolvedSymbols);
        fields.push(`[key: ${keyType.text}]: ${valueType.text}`);
      }

      const indent = '  '.repeat(depth + 1);
      const outerIndent = '  '.repeat(depth);
      return {
        text: `{\n${indent}${fields.join(`;\n${indent}`)}\n${outerIndent}}`,
        unresolvedSymbols,
      };
    }

      return { text: '{ }', unresolvedSymbols: [] };
    }

    return {
      text: checker.typeToString(type),
      unresolvedSymbols: collectTypeSymbolFallback(type),
    };
  } finally {
    if (typeId !== undefined) {
      expandState.stackTypeIds.delete(typeId);
    }
  }
};

export const expandType = (type: ts.Type, checker: ts.TypeChecker, depth = 0): string => {
  return expandTypeDetailed(type, checker, depth).text;
};
