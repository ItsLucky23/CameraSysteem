import chokidar from "chokidar";
import fs from "fs";
import path from 'path';
import { createRequire } from 'module';
import { initializeApis, initializeFunctions, initializeSyncs } from "./loader";
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
import { generateTypeMapFile } from "./typeMapGenerator.js";
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

  const clearModuleCache = (paths: string[]) => {
    const normalizedNeedles = paths.map((value) => value.replace(/\\/g, '/'));
    for (const cacheKey of Object.keys(nodeRequire.cache)) {
      const normalizedCacheKey = cacheKey.replace(/\\/g, '/');
      if (normalizedNeedles.some((needle) => normalizedCacheKey.includes(needle))) {
        delete nodeRequire.cache[cacheKey];
      }
    }
  };

  const clearSrcCache = () => {
    const srcNeedle = `${path.sep}src${path.sep}`.replace(/\\/g, '/');
    clearModuleCache([srcNeedle]);
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

  const isGeneratedPath = (normalizedPath: string): boolean => {
    return (
      normalizedPath.includes('apiTypes.generated.ts')
      || normalizedPath.includes('apiDocs.generated.json')
    );
  };

  const isTypeMapRelevantFile = (normalizedPath: string): boolean => {
    if (isGeneratedPath(normalizedPath)) return false;
    if (!(normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx'))) return false;

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
    const normalizedPath = path.replace(/\\/g, '/');

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
            await tryCatch(generateTypeMapFile);
            // Update client file to use imported types + add serverOutput
            await updateClientFileForPairedServer(clientPath);
            initializeSyncs();
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

    // Handle normal file additions
    handleChange(path);
  };

  const handleChange = async (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');

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

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        await tryCatch(generateTypeMapFile);
      });
    }

    if (normalizedPath.includes('_api/')) {
      scheduleReload('api', async () => {
        clearSrcCache();
        await tryCatch(generateTypeMapFile);
        await initializeApis();
      });
    } else if (isRouteDependencyFile(normalizedPath)) {
      scheduleReload('api', async () => {
        clearSrcCache();
        await tryCatch(generateTypeMapFile);
        await initializeApis();
      });

      scheduleReload('sync', async () => {
        clearSrcCache();
        await tryCatch(generateTypeMapFile);
        await initializeSyncs();
      });
    } else if (normalizedPath.includes('_sync/')) {
      scheduleReload('sync', async () => {
        clearSrcCache();
        await tryCatch(generateTypeMapFile);
        await initializeSyncs();
      });
    }
  };

  const handleFunctionChange = (_path: string) => {
    scheduleReload('functions', async () => {
      await tryCatch(generateTypeMapFile);
      await initializeFunctions();
    });
  };

  const handleDelete = async (path: string) => {
    const normalizedPath = path.replace(/\\/g, '/');

    if (isGeneratedPath(normalizedPath)) {
      return;
    }

    if (isLocaleFile(normalizedPath)) {
      scheduleReload('locales', () => {
        reloadLocaleTranslations();
      });
      return;
    }

    if (isTypeMapRelevantFile(normalizedPath)) {
      scheduleReload('typemap', async () => {
        await generateTypeMapFile();
      });
    }

    if (normalizedPath.includes('_api/')) {
      scheduleReload('api', async () => {
        clearSrcCache();
        await generateTypeMapFile();
        await initializeApis();
      });
    } else if (isRouteDependencyFile(normalizedPath)) {
      scheduleReload('api', async () => {
        clearSrcCache();
        await generateTypeMapFile();
        await initializeApis();
      });

      scheduleReload('sync', async () => {
        clearSrcCache();
        await generateTypeMapFile();
        await initializeSyncs();
      });
    } else if (normalizedPath.includes('_sync/')) {
      scheduleReload('sync', async () => {
        clearSrcCache();

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

        await generateTypeMapFile();
        await initializeSyncs();
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
