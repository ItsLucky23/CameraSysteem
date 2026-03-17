import fs from 'fs';
import path from 'path';
import { ROOT_DIR, SERVER_FUNCTIONS_DIR, SHARED_DIR, SRC_DIR } from '../utils/paths';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'];

const normalizePath = (value: string): string => path.resolve(value).replace(/\\/g, '/');

const isSupportedScriptFile = (value: string): boolean => {
  return SUPPORTED_EXTENSIONS.some((extension) => value.endsWith(extension));
};

const existsFile = (value: string): boolean => {
  try {
    return fs.existsSync(value) && fs.statSync(value).isFile();
  } catch {
    return false;
  }
};

const existsDirectory = (value: string): boolean => {
  try {
    return fs.existsSync(value) && fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
};

const collectScriptFiles = (dir: string, output: Set<string>): void => {
  if (!existsDirectory(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    if (existsDirectory(fullPath)) {
      collectScriptFiles(fullPath, output);
      continue;
    }

    const normalizedPath = normalizePath(fullPath);
    if (isSupportedScriptFile(normalizedPath)) {
      output.add(normalizedPath);
    }
  }
};

const extractImportSpecifiers = (filePath: string): string[] => {
  try {
    const source = fs.readFileSync(filePath, 'utf-8');
    const specifiers = new Set<string>();

    const importExportRegex = /(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]/g;
    const dynamicImportRegex = /import\(\s*['"]([^'"\n]+)['"]\s*\)/g;

    let match: RegExpExecArray | null = null;

    while ((match = importExportRegex.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }

    while ((match = dynamicImportRegex.exec(source)) !== null) {
      if (match[1]) specifiers.add(match[1]);
    }

    return Array.from(specifiers);
  } catch {
    return [];
  }
};

const tryResolveWithExtensions = (basePath: string): string | null => {
  if (existsFile(basePath)) {
    return normalizePath(basePath);
  }

  for (const extension of SUPPORTED_EXTENSIONS) {
    const withExtension = `${basePath}${extension}`;
    if (existsFile(withExtension)) {
      return normalizePath(withExtension);
    }
  }

  if (existsDirectory(basePath)) {
    for (const extension of SUPPORTED_EXTENSIONS) {
      const indexFile = path.join(basePath, `index${extension}`);
      if (existsFile(indexFile)) {
        return normalizePath(indexFile);
      }
    }
  }

  return null;
};

const resolveImportToFile = (importerPath: string, specifier: string): string | null => {
  if (!specifier || specifier.startsWith('node:')) {
    return null;
  }

  if (specifier === 'config') {
    return tryResolveWithExtensions(path.join(ROOT_DIR, 'config'));
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const relativeBase = path.resolve(path.dirname(importerPath), specifier);
    return tryResolveWithExtensions(relativeBase);
  }

  if (specifier.startsWith('src/') || specifier.startsWith('@/')) {
    const sourcePath = specifier.startsWith('@/') ? specifier.slice(2) : specifier.slice(4);
    return tryResolveWithExtensions(path.join(SRC_DIR, sourcePath));
  }

  if (specifier.startsWith('shared/')) {
    return tryResolveWithExtensions(path.join(SHARED_DIR, specifier.slice(7)));
  }

  return null;
};

const isRouteFile = (filePath: string): boolean => {
  return filePath.includes('/src/') && (filePath.includes('/_api/') || filePath.includes('/_sync/'));
};

const collectScopedFiles = (): Set<string> => {
  const files = new Set<string>();
  collectScriptFiles(SRC_DIR, files);
  collectScriptFiles(SHARED_DIR, files);
  collectScriptFiles(SERVER_FUNCTIONS_DIR, files);

  const configFile = tryResolveWithExtensions(path.join(ROOT_DIR, 'config'));
  if (configFile) {
    files.add(configFile);
  }

  return files;
};

export const findDependentRouteFiles = (changedFilePath: string): Set<string> => {
  const scopedFiles = collectScopedFiles();
  const changedAbsolutePath = normalizePath(changedFilePath);

  const reverseDependencies = new Map<string, Set<string>>();

  for (const filePath of scopedFiles) {
    const specifiers = extractImportSpecifiers(filePath);

    for (const specifier of specifiers) {
      const resolvedImport = resolveImportToFile(filePath, specifier);
      if (!resolvedImport || !scopedFiles.has(resolvedImport)) {
        continue;
      }

      if (!reverseDependencies.has(resolvedImport)) {
        reverseDependencies.set(resolvedImport, new Set<string>());
      }

      reverseDependencies.get(resolvedImport)!.add(filePath);
    }
  }

  const affectedRoutes = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [changedAbsolutePath];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    const importers = reverseDependencies.get(current);
    if (!importers) {
      continue;
    }

    for (const importer of importers) {
      if (isRouteFile(importer)) {
        affectedRoutes.add(importer);
      }

      if (!visited.has(importer)) {
        queue.push(importer);
      }
    }
  }

  return affectedRoutes;
};
