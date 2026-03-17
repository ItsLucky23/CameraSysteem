import chokidar from "chokidar";
import fs from "fs";
import path from 'path';
import { createRequire } from 'module';
import {
  initializeFunctions,
  upsertApiFromFile,
  removeApiFromFile,
  upsertSyncFromFile,
  removeSyncFromFile,
} from "./loader";
import {
  shouldInjectTemplate,
  injectTemplate,
  isSyncServerFile,
  getPairedSyncFile,
  extractClientInputFromFile,
  extractClientInputFromGeneratedTypes,
  extractSyncPagePath,
  extractSyncName,
  injectServerTemplateWithClientInput,
  updateClientFileForPairedServer,
  updateClientFileForDeletedServer,
  isEmptyFile
} from "./templateInjector";
import {
  generateTypeMapFile,
} from "./typeMapGenerator.js";
import { findDependentRouteFiles } from "./importDependencyGraph";
import tryCatch from "../functions/tryCatch";
import { reloadLocaleTranslations } from "../utils/responseNormalizer";

// ----------------------------
// Watcher for Hot Reload + Type Generation
// ----------------------------

export const setupWatchers = () => {
  const isDevMode = process.env.NODE_ENV !== 'production';
  if (!isDevMode) return;
  const nodeRequire = createRequire(import.meta.url);
  const reloadTimers = new Map<'api' | 'sync' | 'functions' | 'typemap' | 'locales', NodeJS.Timeout>();
  const pendingApiUpserts = new Set<string>();
  const pendingApiDeletes = new Set<string>();
  const pendingSyncUpserts = new Set<string>();
  const pendingSyncDeletes = new Set<string>();
  const normalizeFsPath = (value: string): string => path.resolve(value).replace(/\\/g, '/');

  const clearModuleCache = (paths: string[]) => {
    const normalizedNeedles = paths.map((value) => value.replace(/\\/g, '/'));
    for (const cacheKey of Object.keys(nodeRequire.cache)) {
      const normalizedCacheKey = cacheKey.replace(/\\/g, '/');
      if (normalizedNeedles.some((needle) => normalizedCacheKey.includes(needle))) {
        delete nodeRequire.cache[cacheKey];
      }
    }
  };

  const isRouteDependencyFile = (normalizedPath: string): boolean => {
    if (!normalizedPath.endsWith('.ts') && !normalizedPath.endsWith('.tsx')) {
      return false;
    }

    if (!normalizedPath.includes('/src/')) {
      return false;
    }

    if (normalizedPath.includes('/_api/') || normalizedPath.includes('/_sync/')) {
      return false;
    }

    if (isGeneratedPath(normalizedPath)) {
      return false;
    }

    return true;
  };

  const isSharedDependencyFile = (normalizedPath: string): boolean => {
    return (normalizedPath.includes('/shared/') || normalizedPath.includes('/server/functions/'))
      && (normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'));
  };

  const enqueueAffectedRoutesFromDependency = (changedPath: string) => {
    const affectedRoutes = findDependentRouteFiles(changedPath);

    if (affectedRoutes.size === 0) {
      console.log(`[HotReload] No API/Sync routes depend on: ${changedPath}`, 'yellow');
      return;
    }

    clearModuleCache([changedPath]);

    let queuedApiCount = 0;
    let queuedSyncCount = 0;

    for (const routePath of affectedRoutes) {
      if (routePath.includes('/_api/')) {
        pendingApiDeletes.delete(routePath);
        pendingApiUpserts.add(routePath);
        queuedApiCount += 1;
      } else if (routePath.includes('/_sync/')) {
        pendingSyncDeletes.delete(routePath);
        pendingSyncUpserts.add(routePath);
        queuedSyncCount += 1;
      }
    }

    console.log(
      `[HotReload] Dependency changed: ${changedPath} -> queued ${queuedApiCount} API and ${queuedSyncCount} Sync route reloads`,
      'blue'
    );

    if (queuedApiCount > 0) {
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    }

    if (queuedSyncCount > 0) {
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }
  };

  const isGeneratedPath = (normalizedPath: string): boolean => {
    return (
      normalizedPath.includes('apiTypes.generated.ts')
      || normalizedPath.includes('apiDocs.generated.json')
    );
  };

  const isTypeMapRelevantFile = (normalizedPath: string): boolean => {
    if (isGeneratedPath(normalizedPath)) return false;
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;
    if (normalizedPath.includes('/_api/') || normalizedPath.includes('/_sync/')) return false;

    return (
      normalizedPath.includes('/src/')
      || normalizedPath.endsWith('/config.ts')
      || normalizedPath.includes('/shared/')
    );
  };

  const isLocaleFile = (normalizedPath: string): boolean => {
    return normalizedPath.includes('/src/_locales/') && normalizedPath.endsWith('.json');
  };

  const scheduleReload = (
    key: 'api' | 'sync' | 'functions' | 'typemap' | 'locales',
    task: () => Promise<void> | void,
    delay = 120
  ) => {
    const activeTimer = reloadTimers.get(key);
    if (activeTimer) {
      clearTimeout(activeTimer);
    }

    const timer = setTimeout(() => {
      reloadTimers.delete(key);
      void task();
    }, delay);

    reloadTimers.set(key, timer);
  };

  const handleAdd = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);

    // Check if this is a new empty file that needs a template
    if (shouldInjectTemplate(path)) {
      // Special handling for sync server files when client already exists
      if (isSyncServerFile(normalizedPath)) {
        const clientPath = getPairedSyncFile(normalizedPath);
        if (clientPath && fs.existsSync(clientPath) && !isEmptyFile(clientPath)) {
          // Extract clientInput types from existing client file
          const clientInputTypes = extractClientInputFromFile(clientPath);
          if (clientInputTypes) {
            // Inject server template with pre-filled clientInput from client
            await injectServerTemplateWithClientInput(path, clientInputTypes);
            // Regenerate types
            await tryCatch(() => generateTypeMapFile({ quiet: true }));
            // Update client file to use imported types + add serverOutput
            await updateClientFileForPairedServer(clientPath);
            await upsertSyncFromFile(path);
            await upsertSyncFromFile(clientPath);
            return;
          }
        }
      }

      // Default template injection
      const injected = await injectTemplate(path);
      if (injected) {
        // Don't continue processing - the template was just injected
        // The next 'change' event will handle it
        return;
      }
    }

    if (normalizedPath.includes('_api/')) {
      pendingApiDeletes.delete(normalizedPath);
      pendingApiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges({ regenerateTypeMap: true });
      });
      return;
    }

    if (normalizedPath.includes('_sync/')) {
      pendingSyncDeletes.delete(normalizedPath);
      pendingSyncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges({ regenerateTypeMap: true });
      });
      return;
    }

    // Handle normal file additions
    handleChange(path);
  };

  const processPendingApiChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    const deletePaths = Array.from(pendingApiDeletes);
    const upsertPaths = Array.from(pendingApiUpserts);
    pendingApiDeletes.clear();
    pendingApiUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] API routes changed (add/delete), regenerating type map`, 'blue');
      await tryCatch(() => generateTypeMapFile({ quiet: true }));
    }

    for (const deletePath of deletePaths) {
      removeApiFromFile(deletePath);
      console.log(`[HotReload] API removed: ${deletePath}`, 'yellow');
    }

    for (const upsertPath of upsertPaths) {
      await upsertApiFromFile(upsertPath);
      console.log(`[HotReload] API reloaded: ${upsertPath}`, 'green');
    }
  };

  const processPendingSyncChanges = async ({ regenerateTypeMap = false }: { regenerateTypeMap?: boolean } = {}) => {
    const deletePaths = Array.from(pendingSyncDeletes);
    const upsertPaths = Array.from(pendingSyncUpserts);
    pendingSyncDeletes.clear();
    pendingSyncUpserts.clear();

    if (regenerateTypeMap) {
      console.log(`[HotReload] Sync routes changed (add/delete), regenerating type map`, 'blue');
      await tryCatch(() => generateTypeMapFile({ quiet: true }));
    }

    for (const deletePath of deletePaths) {
      removeSyncFromFile(deletePath);
      console.log(`[HotReload] Sync removed: ${deletePath}`, 'yellow');
    }

    for (const upsertPath of upsertPaths) {
      await upsertSyncFromFile(upsertPath);
      console.log(`[HotReload] Sync reloaded: ${upsertPath}`, 'green');
    }
  };

  const handleChange = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);

    if (shouldInjectTemplate(path)) {
      const injected = await injectTemplate(path);
      if (injected) {
        return;
      }
    }

    if (isGeneratedPath(normalizedPath)) {
      return;
    }

    if (isLocaleFile(normalizedPath)) {
      scheduleReload('locales', () => {
        reloadLocaleTranslations();
      });
      return;
    }

    if (isRouteDependencyFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Route dependency changed, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Route dependency changed, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
    }

    if (normalizedPath.includes('_api/')) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] API changed, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      pendingApiDeletes.delete(normalizedPath);
      pendingApiUpserts.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes('_sync/')) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Sync changed, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      pendingSyncDeletes.delete(normalizedPath);
      pendingSyncUpserts.add(normalizedPath);
      scheduleReload('sync', async () => {
        await processPendingSyncChanges();
      });
    }
  };

  const handleFunctionChange = (changedPath: string) => {
    const normalizedPath = normalizeFsPath(changedPath);

    scheduleReload('functions', async () => {
      await tryCatch(() => generateTypeMapFile({ quiet: true }));
      await initializeFunctions();
    });

    if (isSharedDependencyFile(normalizedPath)) {
      enqueueAffectedRoutesFromDependency(normalizedPath);
    }
  };

  const handleDelete = async (path: string) => {
    const normalizedPath = normalizeFsPath(path);

    if (isGeneratedPath(normalizedPath)) {
      return;
    }

    if (isLocaleFile(normalizedPath)) {
      scheduleReload('locales', () => {
        reloadLocaleTranslations();
      });
      return;
    }

    if (isRouteDependencyFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Route dependency deleted, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      enqueueAffectedRoutesFromDependency(normalizedPath);
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Route dependency deleted, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
    }

    if (normalizedPath.includes('_api/')) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] API deleted, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      pendingApiUpserts.delete(normalizedPath);
      pendingApiDeletes.add(normalizedPath);
      scheduleReload('api', async () => {
        await processPendingApiChanges();
      });
    } else if (normalizedPath.includes('_sync/')) {
      scheduleReload('typemap', async () => {
        console.log(`[HotReload] Sync deleted, regenerating type map`, 'blue');
        await tryCatch(() => generateTypeMapFile({ quiet: true }));
      });
      pendingSyncUpserts.delete(normalizedPath);
      pendingSyncDeletes.add(normalizedPath);
      scheduleReload('sync', async () => {
        // Special handling for sync server file deletion when client exists
        if (isSyncServerFile(normalizedPath)) {
          const clientPath = getPairedSyncFile(normalizedPath);
          if (clientPath && fs.existsSync(clientPath)) {
            // Extract clientInput types from generated types file (server file is already deleted)
            const pagePath = extractSyncPagePath(normalizedPath);
            const syncName = extractSyncName(normalizedPath);
            const clientInputTypes = extractClientInputFromGeneratedTypes(pagePath, syncName);

            if (clientInputTypes) {
              await updateClientFileForDeletedServer(clientPath, clientInputTypes);
            } else {
              // Fallback if types couldn't be extracted
              await updateClientFileForDeletedServer(clientPath, '{\n    // Types were in _server.ts - please add them here\n  }');
            }
          }
        }

        await processPendingSyncChanges();
      });
    }
  };

  // Watch the main source folders
  chokidar.watch('src', {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 120,
      pollInterval: 20,
    },
  })
    .on('add', handleAdd)
    .on('change', handleChange)
    .on('unlink', handleDelete);

  // Watch functions separately
  chokidar.watch('server/functions', { ignoreInitial: true })
    .on('add', handleFunctionChange)
    .on('change', handleFunctionChange)
    .on('unlink', handleFunctionChange);

  // Watch shared functions separately
  chokidar.watch('shared', { ignoreInitial: true })
    .on('add', handleFunctionChange)
    .on('change', handleFunctionChange)
    .on('unlink', handleFunctionChange);

  // Generate initial type map on startup
  generateTypeMapFile();
};
