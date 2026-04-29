import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { FileImport, ImportCollectors, parseFileTypeContext, sanitizeTypeAndCollectImports } from './typeContext';
import { SERVER_FUNCTIONS_DIR } from '../../utils/paths';
import { expandType, getServerProgram } from './tsProgram';

// Strips default parameter values from argument lists so the generated interface
// is a clean type signature without runtime values.
const stripDefaultValues = (params: string): string => {
  // Replace default values (= expr) while preserving arrow functions (=>)
  return params.replace(/\s*=(?!>)[^,)]+/g, '');
};

const normalizeInlineType = (value: string): string => {
  // Strip line/block comments BEFORE collapsing whitespace. Otherwise a `//`
  // comment inside a multi-line type signature would swallow the rest of the
  // signature once newlines are gone, producing malformed generated types.
  const withoutBlockComments = value.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, ' ');
  return withoutLineComments.replace(/\s+/g, ' ').trim();
};

const simplifyInferredType = (value: string): string => {
  if (/\bPrismaClient\b/.test(value)) return 'PrismaClient';
  if (/\bRedis\b/.test(value)) return 'Redis';
  return value;
};

const findProgramVariableDeclaration = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration;
      }
    }
  }

  return null;
};

const findProgramTypeDeclaration = (
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration | ts.EnumDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === typeName) return statement;
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName) return statement;
    if (ts.isClassDeclaration(statement) && statement.name?.text === typeName) return statement;
    if (ts.isEnumDeclaration(statement) && statement.name.text === typeName) return statement;
  }

  return null;
};

const resolveLocalExportedTypes = ({
  type,
  availableExports,
  checker,
  programSource,
}: {
  type: string;
  availableExports: Set<string>;
  checker: ts.TypeChecker;
  programSource: ts.SourceFile;
}): string => {
  if (availableExports.size === 0) return type;

  let resolved = type;

  for (const exportName of availableExports) {
    const hasReference = new RegExp(`\\b${exportName}\\b`).test(resolved);
    if (!hasReference) continue;

    const declaration = findProgramTypeDeclaration(programSource, exportName);
    if (!declaration) continue;

    const declarationNode = (
      ts.isClassDeclaration(declaration)
      ? (declaration.name ?? declaration)
      : ts.isTypeAliasDeclaration(declaration)
        ? declaration.type
        : declaration
    );

    const declarationType = checker.getTypeAtLocation(declarationNode);
    const expanded = normalizeInlineType(expandType(declarationType, checker));

    resolved = resolved.replace(new RegExp(`\\b${exportName}\\b`, 'g'), expanded);
  }

  return resolved;
};

const findSourceVariableDeclaration = (
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.VariableDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
        return declaration;
      }
    }
  }

  return null;
};

const inferValueTypeForExport = ({
  exportName,
  declaration,
  rawContent,
  filePath,
  availableExports,
  fileImports,
  collectors,
  checker,
  programSource,
}: {
  exportName: string;
  declaration: ts.VariableDeclaration;
  rawContent: string;
  filePath: string;
  availableExports: Set<string>;
  fileImports: Map<string, FileImport>;
  collectors: ImportCollectors;
  checker?: ts.TypeChecker;
  programSource?: ts.SourceFile;
}): string => {
  const resolvedChecker = checker ?? getServerProgram().getTypeChecker();
  const resolvedSource = programSource ?? getServerProgram().getSourceFile(filePath);

  if (declaration.type) {
    const rawType = normalizeInlineType(rawContent.slice(declaration.type.pos, declaration.type.end).trim());
    const localResolvedType = resolvedSource
      ? resolveLocalExportedTypes({
        type: rawType,
        availableExports,
        checker: resolvedChecker,
        programSource: resolvedSource,
      })
      : rawType;

    return sanitizeTypeAndCollectImports({
      type: localResolvedType,
      filePath,
      availableExports,
      fileImports,
      collectors,
    });
  }

  try {
    if (!resolvedSource) return 'any';

    const programDeclaration = findProgramVariableDeclaration(resolvedSource, exportName);
    if (!programDeclaration) return 'any';

    const inferred = resolvedChecker.typeToString(resolvedChecker.getTypeAtLocation(programDeclaration.name));
    const simplified = simplifyInferredType(normalizeInlineType(inferred));
    const localResolvedType = resolveLocalExportedTypes({
      type: simplified,
      availableExports,
      checker: resolvedChecker,
      programSource: resolvedSource,
    });

    return sanitizeTypeAndCollectImports({
      type: localResolvedType,
      filePath,
      availableExports,
      fileImports,
      collectors,
    });
  } catch {
    return 'any';
  }
};

// Extracts a function signature string from an AST function-like node.
const extractSignatureFromNode = (
  node: ts.FunctionLikeDeclaration,
  rawContent: string,
  filePath: string,
  availableExports: Set<string>,
  fileImports: Map<string, FileImport>,
  collectors: ImportCollectors,
  checker?: ts.TypeChecker,
  programSource?: ts.SourceFile,
): string => {
  // Collect generic type parameter names to avoid replacing them with 'any'
  const knownGenerics = new Set<string>();
  if (node.typeParameters) {
    for (const typeParam of node.typeParameters) {
      knownGenerics.add(typeParam.name.text);
    }
  }

  const isAsync = node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;

  // Generic clause text (<T, U extends string>)
  const genericsClause = node.typeParameters
    ? `<${rawContent.slice(node.typeParameters.pos, node.typeParameters.end).trim()}>`
    : '';

  // Parameter list text with default values removed
  const rawParams = node.parameters
    .map(p => normalizeInlineType(rawContent.slice(p.pos, p.end).trim()))
    .join(', ');
  const cleanParams = normalizeInlineType(stripDefaultValues(`(${rawParams})`));
  const localResolvedParams = (checker && programSource)
    ? resolveLocalExportedTypes({
      type: cleanParams,
      availableExports,
      checker,
      programSource,
    })
    : cleanParams;

  const sanitizedParams = sanitizeTypeAndCollectImports({
    type: localResolvedParams,
    filePath,
    availableExports,
    fileImports,
    knownGenerics,
    collectors,
  });

  // Return type annotation
  let returnTypeStr = isAsync ? 'Promise<any>' : 'any';
  if (node.type) {
    const rawReturnType = normalizeInlineType(rawContent.slice(node.type.pos, node.type.end).trim());
    const localResolvedReturnType = (checker && programSource)
      ? resolveLocalExportedTypes({
        type: rawReturnType,
        availableExports,
        checker,
        programSource,
      })
      : rawReturnType;

    returnTypeStr = sanitizeTypeAndCollectImports({
      type: localResolvedReturnType,
      filePath,
      availableExports,
      fileImports,
      knownGenerics,
      collectors,
    });
    if (isAsync && !returnTypeStr.startsWith('Promise')) {
      returnTypeStr = `Promise<${returnTypeStr}>`;
    }
  }

  return `${genericsClause}${sanitizedParams} => ${returnTypeStr}`;
};

// Finds and returns the signature for a named export within a parsed source file.
const findSignatureForExport = (
  name: string,
  sourceFile: ts.SourceFile,
  rawContent: string,
  filePath: string,
  availableExports: Set<string>,
  fileImports: Map<string, FileImport>,
  collectors: ImportCollectors,
  checker?: ts.TypeChecker,
  programSource?: ts.SourceFile,
): string => {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue;
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          return extractSignatureFromNode(decl.initializer, rawContent, filePath, availableExports, fileImports, collectors, checker, programSource);
        }
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return extractSignatureFromNode(statement, rawContent, filePath, availableExports, fileImports, collectors, checker, programSource);
    }
  }

  return 'any';
};

const generateFunctionsForDir = (dir: string, collectors: ImportCollectors, indent = '\t'): string => {
  if (!fs.existsSync(dir)) return '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let output = '';

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subOutput = generateFunctionsForDir(fullPath, collectors, `${indent}  `);
      if (subOutput.trim()) {
        output += `${indent}${entry.name}: {\n${subOutput}${indent}};\n`;
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;

    const fileName = entry.name.replace('.ts', '');
    let fileOutput = '';

    try {
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const sourceFile = ts.createSourceFile(fullPath, rawContent, ts.ScriptTarget.Latest, true);
      const { availableExports, fileImports } = parseFileTypeContext(rawContent);
      const program = getServerProgram();
      const checker = program.getTypeChecker();
      const programSource = program.getSourceFile(fullPath);
      const exports = new Map<string, string>();
      let defaultExportName: string | null = null;

      for (const statement of sourceFile.statements) {
        const hasExport = (statement as ts.HasModifiers).modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);

        if (ts.isVariableStatement(statement) && hasExport) {
          for (const decl of statement.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              const exportName = decl.name.text;

              if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
                exports.set(exportName, findSignatureForExport(exportName, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined));
                continue;
              }

              exports.set(exportName, inferValueTypeForExport({
                exportName,
                declaration: decl,
                rawContent,
                filePath: fullPath,
                availableExports,
                fileImports,
                collectors,
                checker,
                programSource: programSource ?? undefined,
              }));
            }
          }
        }

        if (ts.isFunctionDeclaration(statement) && hasExport && statement.name) {
          exports.set(statement.name.text, findSignatureForExport(statement.name.text, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined));
        }

        // export { a, b as c }
        if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const specifier of statement.exportClause.elements) {
            const exportName = specifier.name.text;
            const originalName = specifier.propertyName ? specifier.propertyName.text : exportName;

            const signature = findSignatureForExport(originalName, sourceFile, rawContent, fullPath, availableExports, fileImports, collectors, checker, programSource ?? undefined);
            if (signature !== 'any') {
              exports.set(exportName, signature);
              continue;
            }

            const exportDeclaration = findSourceVariableDeclaration(sourceFile, originalName);
            if (exportDeclaration && ts.isIdentifier(exportDeclaration.name)) {
              exports.set(exportName, inferValueTypeForExport({
                exportName: originalName,
                declaration: exportDeclaration,
                rawContent,
                filePath: fullPath,
                availableExports,
                fileImports,
                collectors,
                checker,
                programSource: programSource ?? undefined,
              }));
              continue;
            }

            exports.set(exportName, 'any');
          }
        }

        // export default someIdentifier
        if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) {
          defaultExportName = statement.expression.text;
        }
      }

      const defaultSig = defaultExportName ? exports.get(defaultExportName) : undefined;
      if (defaultSig) exports.delete(defaultExportName!);

      for (const [exportName, sig] of exports) {
        fileOutput += `${indent}  ${exportName}: ${sig};\n`;
      }

      if (defaultSig && !fileOutput.trim()) {
        fileOutput += `${indent}  ${fileName}: ${defaultSig};\n`;
      }

      if (fileOutput) {
        output += `${indent}${fileName}: {\n${fileOutput}${indent}};\n`;
      }
    } catch (err) {
      console.error(`[TypeMapGenerator] Error parsing functions file ${fullPath}:`, err);
    }
  }

  return output;
};

export const generateServerFunctions = (collectors: ImportCollectors): string => {
  return generateFunctionsForDir(SERVER_FUNCTIONS_DIR, collectors, '\t');
};
