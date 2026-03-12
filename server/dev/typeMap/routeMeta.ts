import path from 'path';

const VERSION_SUFFIX_REGEX = /_v(\d+)$/;

const ROUTE_ALIAS_MAP: Record<string, string[]> = {
  afas: ['timeregister2'],
};

const stripVersionSuffix = (name: string): string => {
  return name.replace(VERSION_SUFFIX_REGEX, '');
};

const extractVersionFromName = (name: string): string | null => {
  const match = name.match(VERSION_SUFFIX_REGEX);
  if (!match) return null;
  return `v${match[1]}`;
};

export const extractPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(?:(.+?)\/)_api\//);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_api/')) {
    return 'root';
  }
  return '';
};

export const extractApiName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return stripVersionSuffix(rawName);
};

export const extractApiVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_api\/(.+)\.ts$/);
  const rawName = match ? match[1] : path.basename(filePath, '.ts');
  return extractVersionFromName(rawName) || 'v1';
};

export const extractSyncPagePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/src\/(?:(.+?)\/)_sync\//);
  if (match) {
    return match[1] || 'root';
  }
  if (normalized.includes('/src/_sync/')) {
    return 'root';
  }
  return '';
};

export const extractSyncName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_sync\/(.+)\.ts$/);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const rawName = basename
      .replace(/_server_v\d+$/, '')
      .replace(/_client_v\d+$/, '');
    return rawName;
  }

  const rawName = match[1]
    .replace(/_server_v\d+$/, '')
    .replace(/_client_v\d+$/, '');

  return rawName;
};

export const extractSyncVersion = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/_sync\/(.+)\.ts$/);
  if (!match) {
    const basename = path.basename(filePath, '.ts');
    const versionMatch = basename.match(/_(?:server|client)_v(\d+)$/);
    return versionMatch ? `v${versionMatch[1]}` : 'v1';
  }

  const versionMatch = match[1].match(/_(?:server|client)_v(\d+)$/);
  return versionMatch ? `v${versionMatch[1]}` : 'v1';
};

export const getRouteAliases = (pagePath: string): string[] => {
  return ROUTE_ALIAS_MAP[pagePath] ?? [];
};
