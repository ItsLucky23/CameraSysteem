import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { GENERATED_API_DOCS_PATH, GENERATED_SOCKET_TYPES_PATH } from '../../utils/paths';

export interface ApiTypeEntry {
	input: string;
	output: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	rateLimit: number | false | undefined;
	auth: any;
	version: string;
}

export interface SyncTypeEntry {
	clientInput: string;
	serverOutput: string;
	clientOutput: string;
	version: string;
}

const buildImportStatements = ({
	namedImports,
	defaultImports,
}: {
	namedImports: Map<string, Set<string>>;
	defaultImports: Map<string, string>;
}): string => {
	let importStatements = '';
	for (const [importPath, types] of namedImports) {
		importStatements += `import { ${Array.from(types).join(', ')} } from "${importPath}";\n`;
	}
	for (const [importPath, defaultName] of defaultImports) {
		importStatements += `import ${defaultName} from "${importPath}";\n`;
	}
	return importStatements;
};

const splitVersionedKey = (value: string): { name: string; version: string } => {
	const [name, version] = value.split('@');
	return { name, version: version || 'v1' };
};

const writeFileIfChanged = (filePath: string, content: string): boolean => {
	if (fs.existsSync(filePath)) {
		const currentContent = fs.readFileSync(filePath, 'utf-8');
		if (currentContent === content) {
			return false;
		}
	}

	fs.writeFileSync(filePath, content, 'utf-8');
	return true;
};

const indentStr = (str: string, indentText: string): string => {
	return str.split('\n').map((line, i) => i === 0 ? line : indentText + line).join('\n');
};

const validateGeneratedTypeIdentifiers = (content: string): void => {
	const sourceFile = ts.createSourceFile('apiTypes.generated.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const knownSymbols = new Set<string>();
	const referencedSymbols = new Set<string>();

	const builtIns = new Set([
		'string', 'number', 'boolean', 'null', 'undefined', 'unknown', 'any', 'never', 'void', 'object', 'bigint', 'symbol',
		'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Readonly', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
		'Awaited', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'ReadonlyArray', 'Date', 'Error', 'RegExp',
		'True', 'False', 'JsonPrimitive', 'JsonValue', 'JsonObject', 'JsonArray',
	]);

	const addDeclaredName = (name?: ts.Identifier): void => {
		if (!name?.text) return;
		knownSymbols.add(name.text);
	};

	const collectTypeParams = (node: ts.Node): void => {
		if (!('typeParameters' in node)) return;
		const maybeTypeParameters = (node as ts.Node & { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
		if (!maybeTypeParameters) return;
		for (const typeParameter of maybeTypeParameters) {
			knownSymbols.add(typeParameter.name.text);
		}
	};

	const collectKnownSymbols = (node: ts.Node): void => {
		if (ts.isInferTypeNode(node)) {
			knownSymbols.add(node.typeParameter.name.text);
		}

		if (ts.isMappedTypeNode(node) && node.typeParameter?.name) {
			knownSymbols.add(node.typeParameter.name.text);
		}

		if (ts.isImportDeclaration(node)) {
			const importClause = node.importClause;
			if (importClause?.name) knownSymbols.add(importClause.name.text);
			if (importClause?.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
				for (const importElement of importClause.namedBindings.elements) {
					knownSymbols.add((importElement.propertyName ?? importElement.name).text);
				}
			}
			if (importClause?.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
				knownSymbols.add(importClause.namedBindings.name.text);
			}
		}

		if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isFunctionDeclaration(node)) {
			addDeclaredName(node.name as ts.Identifier | undefined);
			collectTypeParams(node);
		}

		if (ts.isTypeReferenceNode(node)) {
			const typeName = node.typeName;
			if (ts.isIdentifier(typeName)) {
				referencedSymbols.add(typeName.text);
			}
			if (ts.isQualifiedName(typeName) && ts.isIdentifier(typeName.left)) {
				referencedSymbols.add(typeName.left.text);
			}
		}

		ts.forEachChild(node, collectKnownSymbols);
	};

	collectKnownSymbols(sourceFile);

	const unknown = Array.from(referencedSymbols)
		.filter((name) => !knownSymbols.has(name) && !builtIns.has(name))
		.sort();

	if (unknown.length > 0) {
		throw new Error(`[TypeMapGenerator] Generated type map has unresolved type identifiers: ${unknown.join(', ')}`);
	}
};

export const buildTypeMapArtifacts = ({
	typesByPage,
	syncTypesByPage,
	namedImports,
	defaultImports,
	functionsInterface,
}: {
	typesByPage: Map<string, Map<string, ApiTypeEntry>>;
	syncTypesByPage: Map<string, Map<string, SyncTypeEntry>>;
	namedImports: Map<string, Set<string>>;
	defaultImports: Map<string, string>;
	functionsInterface: string;
}) => {
	const importStatements = buildImportStatements({ namedImports, defaultImports });

	let content = `/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/ban-types */
// @ts-nocheck

/**
 * Auto-generated type map for all API and Sync endpoints.
 * Enables type-safe apiRequest and syncRequest calls.
 */

import { SessionLayout } from "../../config";
${importStatements}
export interface Functions {
${functionsInterface}
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
	[key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type ApiResponse<T = unknown> =
	| ({ status: 'success'; httpStatus?: number; APINAME?: never; [key: string]: unknown } & T)
	| { status: 'error'; httpStatus?: number; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[]; APINAME?: never };

export type ApiNetworkResponse<T = unknown> =
	| ({ status: 'success'; httpStatus: number; APINAME?: never; [key: string]: unknown } & T)
	| { status: 'error'; httpStatus: number; message: string; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[]; APINAME?: never };

// ═══════════════════════════════════════════════════════════════════════════════
// API Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface ApiTypeMap {
`;

	const sortedPages = Array.from(typesByPage.keys()).sort();
	const sortedSyncPages = Array.from(syncTypesByPage.keys()).sort();
	const docsData: any = { apis: {}, syncs: {} };

	for (const pagePath of sortedPages) {
		const apis = typesByPage.get(pagePath)!;
		const grouped = new Map<string, Array<{ version: string; entry: ApiTypeEntry }>>();

		docsData.apis[pagePath] = [];

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			grouped.get(name)!.push({ version, entry });
		}

		content += `  '${pagePath}': {\n`;
		for (const apiName of Array.from(grouped.keys()).sort()) {
			content += `    '${apiName}': {\n`;
			for (const { version, entry } of grouped.get(apiName)!.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) {
				docsData.apis[pagePath].push({
					page: pagePath,
					name: apiName,
					version,
					method: entry.method,
					input: entry.input,
					output: entry.output,
					rateLimit: entry.rateLimit,
					auth: entry.auth,
					path: pagePath === 'root' ? `api/${apiName}/${version}` : `api/${pagePath}/${apiName}/${version}`,
				});

				content += `      '${version}': {\n`;
				content += `        input: ${indentStr(entry.input, '        ')};\n`;
				content += `        output: ${indentStr(entry.output, '        ')};\n`;
				content += `        method: '${entry.method}';\n`;
				if (entry.rateLimit !== undefined) {
					content += `        rateLimit: ${entry.rateLimit};\n`;
				}
				content += `      };\n`;
			}
			content += `    };\n`;
		}
		content += `  };\n`;
	}

	content += `}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type PagePath = keyof ApiTypeMap;
export type ApiName<P extends PagePath> = keyof ApiTypeMap[P];
export type ApiVersion<P extends PagePath, N extends ApiName<P>> = keyof ApiTypeMap[P][N];
export type ApiInput<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { input: infer I } ? I : never;
export type ApiOutput<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { output: infer O } ? O : never;
export type ApiMethod<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N> = ApiVersion<P, N>> = ApiTypeMap[P][N][V] extends { method: infer M } ? M : never;

export type FullApiPath<P extends PagePath, N extends ApiName<P>, V extends ApiVersion<P, N>> = \`api/\${P}/\${N & string}/\${V & string}\`;

export const apiMethodMap: Record<string, Record<string, Record<string, HttpMethod>>> = {
`;

	for (const pagePath of sortedPages) {
		const apis = typesByPage.get(pagePath)!;
		const grouped = new Map<string, Array<{ version: string; method: string }>>();

		for (const [apiKey, entry] of apis.entries()) {
			const { name, version } = splitVersionedKey(apiKey);
			if (!grouped.has(name)) grouped.set(name, []);
			grouped.get(name)!.push({ version, method: entry.method });
		}

		content += `  '${pagePath}': {\n`;
		for (const apiName of Array.from(grouped.keys()).sort()) {
			content += `    '${apiName}': {`;
			const methods = grouped.get(apiName)!
				.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
				.map((item) => ` '${item.version}': '${item.method}'`)
				.join(',');
			content += `${methods} },\n`;
		}
		content += `  },\n`;
	}

	content += `};

export const getApiMethod = (pagePath: string, apiName: string, version: string): HttpMethod | undefined => {
	return apiMethodMap[pagePath]?.[apiName]?.[version];
};

// Sync Type Definitions
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncServerResponse<T = unknown> =
	| ({ status: 'success'; [key: string]: unknown } & T)
	| { status: 'error'; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[] };

export type SyncClientResponse<T = unknown> =
	| ({ status: 'success'; [key: string]: unknown } & T)
	| { status: 'error'; errorCode: string; errorParams?: { key: string; value: string | number | boolean; }[] };

// ═══════════════════════════════════════════════════════════════════════════════
// Sync Type Map
// ═══════════════════════════════════════════════════════════════════════════════

export interface SyncTypeMap {
`;

	for (const pagePath of sortedSyncPages) {
		const syncs = syncTypesByPage.get(pagePath)!;
		const grouped = new Map<string, Array<{ version: string; entry: SyncTypeEntry }>>();
		docsData.syncs[pagePath] = [];

		for (const [syncKey, entry] of syncs.entries()) {
			const { name, version } = splitVersionedKey(syncKey);
			if (!grouped.has(name)) grouped.set(name, []);
			grouped.get(name)!.push({ version, entry });
		}

		content += `  '${pagePath}': {\n`;
		for (const syncName of Array.from(grouped.keys()).sort()) {
			content += `    '${syncName}': {\n`;
			for (const { version, entry } of grouped.get(syncName)!.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))) {
				docsData.syncs[pagePath].push({
					page: pagePath,
					name: syncName,
					version,
					clientInput: entry.clientInput,
					serverOutput: entry.serverOutput,
					clientOutput: entry.clientOutput,
					path: pagePath === 'root' ? `sync/${syncName}/${version}` : `sync/${pagePath}/${syncName}/${version}`,
				});

				content += `      '${version}': {\n`;
				content += `        clientInput: ${indentStr(entry.clientInput, '        ')};\n`;
				content += `        serverOutput: ${indentStr(entry.serverOutput, '        ')};\n`;
				content += `        clientOutput: ${indentStr(entry.clientOutput, '        ')};\n`;
				content += `      };\n`;
			}
			content += `    };\n`;
		}
		content += `  };\n`;
	}

	content += `}

export type SyncPagePath = keyof SyncTypeMap;
export type SyncName<P extends SyncPagePath> = keyof SyncTypeMap[P];
export type SyncVersion<P extends SyncPagePath, N extends SyncName<P>> = keyof SyncTypeMap[P][N];
export type SyncClientInput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { clientInput: infer C } ? C : never;
export type SyncServerOutput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { serverOutput: infer S } ? S : never;
export type SyncClientOutput<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N> = SyncVersion<P, N>> = SyncTypeMap[P][N][V] extends { clientOutput: infer O } ? O : never;

export type FullSyncPath<P extends SyncPagePath, N extends SyncName<P>, V extends SyncVersion<P, N>> = \`sync/\${P}/\${N & string}/\${V & string}\`;
`;

	validateGeneratedTypeIdentifiers(content);

	return { content, docsData };
};

export const writeTypeMapArtifacts = ({
	content,
	docsData,
}: {
	content: string;
	docsData: any;
}) => {
	try {
		const outputPath = GENERATED_SOCKET_TYPES_PATH;
		const hasUpdatedTypeMap = writeFileIfChanged(outputPath, content);
		if (hasUpdatedTypeMap) {
			console.log('[TypeMapGenerator] Generated apiTypes.generated.ts');
		}

		const docsPath = GENERATED_API_DOCS_PATH;
		const docsDir = path.dirname(docsPath);
		if (!fs.existsSync(docsDir)) {
			fs.mkdirSync(docsDir, { recursive: true });
		}
		const docsContent = JSON.stringify(docsData, null, 2);
		const hasUpdatedDocs = writeFileIfChanged(docsPath, docsContent);
		if (hasUpdatedDocs) {
			console.log('[TypeMapGenerator] Generated apiDocs.generated.json');
		}
	} catch (error) {
		console.error('[TypeMapGenerator] Error writing type map or docs:', error);
	}
};
