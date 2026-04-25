import { useCallback, useEffect, useMemo, useState } from 'react';

import { backendUrl, sessionBasedToken } from 'config';
import notify from 'src/_functions/notify';
import Dropdown from 'src/_components/Dropdown';
import Icon from 'src/_components/Icon';
import { useTranslator } from 'src/_functions/translator';
import tryCatch from 'shared/tryCatch';

export const template = 'ops';

type Quality = 'low' | 'medium' | 'high';

interface CameraCatalogItem {
  id: string;
  slug: string;
  name: string;
  cameraIp: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  targetFps: number;
  quality: Quality;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CameraViewModel {
  camera: CameraCatalogItem;
  previewSource: string;
  isOffline: boolean;
  uptime: string;
  latencyMs: number;
}

type CameraCatalogResponse =
  | {
      status: 'success';
      cameras: CameraCatalogItem[];
    }
  | {
      status: 'error';
      errorCode: string;
    };

type CameraCreateResponse =
  | {
      status: 'success';
      camera: CameraCatalogItem;
    }
  | {
      status: 'error';
      errorCode: string;
    };

type CameraUpdateResponse =
  | {
      status: 'success';
      camera: CameraCatalogItem;
    }
  | {
      status: 'error';
      errorCode: string;
    };

type CameraDeleteResponse =
  | {
      status: 'success';
      cameraId: string;
    }
  | {
      status: 'error';
      errorCode: string;
    };

type ConfigMode = 'create' | 'edit';
type CameraFilter = 'all' | 'online' | 'offline';

const storageCapacityTb = 100;

const cameraPreviewSources = [
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCHRDaAGDYq5vcEFvUiv-ZC3cjER5NptSIkNj8nmBCkAkrUutoGxV8TdRfczlrN9eFa6eez_lPV8V7oUIH41bq9nhMQyoYWCvIU9o22SVhjN_rMQsXYaW8ekFu4J_y9_Y3_8XJaYfmIMIJe3jOjvnvppU4dczbVBSN84jji5FyOED50ZSCSQ-IgQ9zvcORqHBCZ0CWb5if-xaqKeLEMU6rcrbSqCV7BEAZINcLSPFJBPfBCKUlWIBKQy7LXJ_nnfEEn_m0qhoBWGxY',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuD14a21ifBG7QN5oqaBQ3QlaMPECev3AiAK_VcEvU44zdvjh6pIWv9sRaUf84XkxJCNb4p1wexaK1EJX5jn5oG1YRpklJRo0XzzU1YJJ-qKmJFwDbJdS3Cy8JoG0ZQCCkZxRf3Y3fZLgZW9rfMGDdYs188ZFs-5Kz14kyy1kHLYpCcYZPbBa-9-QAUcG_m0kZP3RkmX5whcHVsv50YgRmD60U-U1ch5LP_SKvwR-g8Ir-0nHdUjcpMCfNJ4XOZhe7FdKTYF7YRmfrg',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA3yYyT-NEVUV7QseMGKqcsk1D56xPTW0czUfhtrjVrTSY80uxUpK9B_ba_i59_V7ot8SCtCc_IS-MTdRLnt8DwRhgfEQwcAbn5GEsYyoxXSIbZGNvoX-NWfgChxKH9PnexnvzKmjcVi-0Zkcl-nfcazbvKnTpoRa0o9BT8B2o5eMPJ--weymJUTvubYbFsRLzBluGZ5jdp9Jd0oOQUCHXUDqbWh8suiEuuGtoCo48W7kvW-CwuZEjeQBw6dOUetlAImfxf-SbdJAI',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBeKC1MX7r72ICx9vl131HiK6FDWNMxBi3BKy8UpOLAQMTpE4zOPzr-upt5TGfEpAccpMuKoPurzgBvpd_yc1gkTm72A0D9uXn6qY5N29ud2qzQOkhnaxBA3XOH9nzmEdPOug8iQP95sq0atu-UCPr7FDFW2qOcouYJzvJvTMj9tItkHBxwuLOg8xcxVYZW8ewAni0ZxX8XczGxstz-HBDRsf7uJtwCsoBUkRoxCGMlY_LmCvYxHcYt9sF29dXaNgIm-k0QkxLfu-4',
];

const getDeterministicLatency = (cameraId: string): number => {
  const hash = cameraId
    .split('')
    .reduce((value, char) => value + char.charCodeAt(0), 0);

  return (hash % 80) + 18;
};

const getDeterministicUptimeMs = (cameraId: string): number => {
  const base = cameraId
    .split('')
    .reduce((value, char) => value + char.charCodeAt(0), 0);

  const days = (base % 12) + 1;
  const hours = base % 24;
  const minutes = base % 59;

  return (((days * 24) + hours) * 60 + minutes) * 60 * 1000;
};

const formatDuration = (durationMs: number): string => {
  const safe = Math.max(0, durationMs);
  const totalMinutes = Math.floor(safe / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  return `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}h`;
};

export default function AdminPage() {
  const translate = useTranslator();

  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [savingCamera, setSavingCamera] = useState<boolean>(false);
  const [deletingCamera, setDeletingCamera] = useState<boolean>(false);
  const [cameraCatalog, setCameraCatalog] = useState<CameraCatalogItem[]>([]);

  const [cameraFilter, setCameraFilter] = useState<CameraFilter>('all');

  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [panelMode, setPanelMode] = useState<ConfigMode>('create');
  const [panelCameraId, setPanelCameraId] = useState<string | null>(null);
  const [disableFeed, setDisableFeed] = useState<boolean>(false);

  const [form, setForm] = useState<{
    slug: string;
    name: string;
    cameraIp: string;
    targetFps: number;
    quality: Quality;
  }>({
    slug: '',
    name: '',
    cameraIp: '',
    targetFps: 15,
    quality: 'medium',
  });

  const qualityItems = useMemo(() => {
    return [
      { id: 'low', value: 'low', item: translate({ key: 'adminCameraManager.qualityLow' }) },
      { id: 'medium', value: 'medium', item: translate({ key: 'adminCameraManager.qualityMedium' }) },
      { id: 'high', value: 'high', item: translate({ key: 'adminCameraManager.qualityHigh' }) },
    ];
  }, [translate]);

  const selectedQualityItem = useMemo(() => {
    return qualityItems.find((item) => item.value === form.quality) ?? qualityItems[1];
  }, [qualityItems, form.quality]);

  const onlineCount = useMemo(() => {
    return cameraCatalog.filter((camera) => camera.isOnline).length;
  }, [cameraCatalog]);

  const offlineCount = useMemo(() => {
    return cameraCatalog.filter((camera) => !camera.isOnline).length;
  }, [cameraCatalog]);

  const simulatedStorageUsedTb = useMemo(() => {
    const value = (cameraCatalog.length * 2.9) + (onlineCount * 0.6);
    return value.toFixed(1);
  }, [cameraCatalog.length, onlineCount]);

  const simulatedStorageUsagePercent = useMemo(() => {
    const used = Number(simulatedStorageUsedTb);
    return Math.min(100, Math.round((used / storageCapacityTb) * 100));
  }, [simulatedStorageUsedTb]);

  const remainingStorageTb = useMemo(() => {
    return Math.max(0, storageCapacityTb - Number(simulatedStorageUsedTb)).toFixed(1);
  }, [simulatedStorageUsedTb]);

  const filterItems = useMemo(() => {
    return [
      {
        id: 'all',
        value: 'all',
        item: translate({ key: 'adminManage.filterAll' }),
      },
      {
        id: 'online',
        value: 'online',
        item: translate({ key: 'adminCameraManager.online' }),
      },
      {
        id: 'offline',
        value: 'offline',
        item: translate({ key: 'adminCameraManager.offline' }),
      },
    ];
  }, [translate]);

  const selectedFilterItem = useMemo(() => {
    return filterItems.find((item) => item.value === cameraFilter) ?? filterItems[0];
  }, [cameraFilter, filterItems]);

  const filteredCameraCatalog = useMemo(() => {
    if (cameraFilter === 'online') {
      return cameraCatalog.filter((camera) => camera.isOnline);
    }

    if (cameraFilter === 'offline') {
      return cameraCatalog.filter((camera) => !camera.isOnline);
    }

    return cameraCatalog;
  }, [cameraCatalog, cameraFilter]);

  const cameraViewModels = useMemo<CameraViewModel[]>(() => {
    return filteredCameraCatalog.map((camera, index) => {
      const parsedLastSeenAt = camera.lastSeenAt ? Date.parse(camera.lastSeenAt) : Number.NaN;
      const uptimeMs = Number.isFinite(parsedLastSeenAt)
        ? Date.now() - parsedLastSeenAt
        : getDeterministicUptimeMs(camera.id);

      const isOffline = !camera.isOnline;

      return {
        camera,
        previewSource: cameraPreviewSources[index % cameraPreviewSources.length],
        isOffline,
        uptime: isOffline ? '--' : formatDuration(uptimeMs),
        latencyMs: getDeterministicLatency(camera.id),
      };
    });
  }, [filteredCameraCatalog]);

  const authorizedHeaders = useCallback((): Record<string, string> => {
    if (!sessionBasedToken) {
      return {};
    }

    const token = sessionStorage.getItem('token');
    if (!token) {
      return {};
    }

    return {
      Authorization: `Bearer ${token}`,
    };
  }, []);

  const fetchCameraCatalog = useCallback(async () => {
    setLoadingCatalog(true);

    const [requestError, response] = await tryCatch(async () => {
      return fetch(`${backendUrl}/api/admin/getCameraCatalog/v1`, {
        method: 'GET',
        headers: {
          ...authorizedHeaders(),
        },
        credentials: 'include',
      });
    });

    if (requestError || !response) {
      setLoadingCatalog(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => {
      return response.json() as Promise<CameraCatalogResponse>;
    });

    if (parseError || !parsedBody) {
      setLoadingCatalog(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    if (parsedBody.status === 'error') {
      setLoadingCatalog(false);
      notify.error({ key: parsedBody.errorCode });
      return;
    }

    setCameraCatalog(parsedBody.cameras);
    setLoadingCatalog(false);
  }, [authorizedHeaders]);

  useEffect(() => {
    void fetchCameraCatalog();
  }, [fetchCameraCatalog]);

  const createCamera = useCallback(async () => {
    const payload = {
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      cameraIp: form.cameraIp.trim(),
      targetFps: form.targetFps,
      quality: form.quality,
    };

    if (!payload.slug || !payload.name || !payload.cameraIp) {
      notify.error({ key: 'camera.invalidInput' });
      return;
    }

    setSavingCamera(true);

    const [requestError, response] = await tryCatch(async () => {
      return fetch(`${backendUrl}/api/admin/createCamera/v1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authorizedHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    });

    if (requestError || !response) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => {
      return response.json() as Promise<CameraCreateResponse>;
    });

    if (parseError || !parsedBody) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    if (parsedBody.status === 'error') {
      setSavingCamera(false);
      notify.error({ key: parsedBody.errorCode });
      return;
    }

    setCameraCatalog((previous) => [parsedBody.camera, ...previous].sort((first, second) => first.name.localeCompare(second.name)));
    setForm({ slug: '', name: '', cameraIp: '', targetFps: 15, quality: 'medium' });
    setPanelOpen(false);
    setSavingCamera(false);
    notify.success({ key: 'adminCameraManager.created' });
  }, [authorizedHeaders, form]);

  const updateCamera = useCallback(async () => {
    if (!panelCameraId) {
      return;
    }

    const payload = {
      cameraId: panelCameraId,
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      cameraIp: form.cameraIp.trim(),
      targetFps: form.targetFps,
      quality: form.quality,
    };

    if (!payload.slug || !payload.name || !payload.cameraIp) {
      notify.error({ key: 'camera.invalidInput' });
      return;
    }

    setSavingCamera(true);

    const [requestError, response] = await tryCatch(async () => {
      return fetch(`${backendUrl}/api/admin/updateCamera/v1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authorizedHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
    });

    if (requestError || !response) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => {
      return response.json() as Promise<CameraUpdateResponse>;
    });

    if (parseError || !parsedBody) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    if (parsedBody.status === 'error') {
      setSavingCamera(false);
      notify.error({ key: parsedBody.errorCode });
      return;
    }

    setCameraCatalog((previous) => previous
      .map((camera) => (camera.id === parsedBody.camera.id ? parsedBody.camera : camera))
      .sort((first, second) => first.name.localeCompare(second.name)));

    setSavingCamera(false);
    setPanelOpen(false);
    notify.success({ key: 'adminManage.saved' });
  }, [authorizedHeaders, form, panelCameraId]);

  const deleteCamera = useCallback(async () => {
    if (!panelCameraId) {
      return;
    }

    setDeletingCamera(true);

    const [requestError, response] = await tryCatch(async () => {
      return fetch(`${backendUrl}/api/admin/deleteCamera/v1`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...authorizedHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({ cameraId: panelCameraId }),
      });
    });

    if (requestError || !response) {
      setDeletingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => {
      return response.json() as Promise<CameraDeleteResponse>;
    });

    if (parseError || !parsedBody) {
      setDeletingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    if (parsedBody.status === 'error') {
      setDeletingCamera(false);
      notify.error({ key: parsedBody.errorCode });
      return;
    }

    setCameraCatalog((previous) => previous.filter((camera) => camera.id !== parsedBody.cameraId));
    setDeletingCamera(false);
    setPanelOpen(false);
    notify.success({ key: 'adminManage.deleted' });
  }, [authorizedHeaders, panelCameraId]);

  const openCreatePanel = useCallback(() => {
    setPanelMode('create');
    setPanelCameraId(null);
    setForm({ slug: '', name: '', cameraIp: '', targetFps: 15, quality: 'medium' });
    setDisableFeed(false);
    setPanelOpen(true);
  }, []);

  const openEditPanel = useCallback((camera: CameraCatalogItem) => {
    setPanelMode('edit');
    setPanelCameraId(camera.id);
    setForm({
      slug: camera.slug,
      name: camera.name,
      cameraIp: camera.cameraIp,
      targetFps: camera.targetFps,
      quality: camera.quality,
    });
    setDisableFeed(!camera.isOnline);
    setPanelOpen(true);
  }, []);

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-6 px-4 py-4 md:px-6 md:py-6 [container-type:inline-size]">
        <div className="[@container(min-width:72rem)]:hidden">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
            <div className="flex items-end justify-between gap-4 px-1">
              <div className="flex flex-col gap-1">
                <div className="text-3xl font-black tracking-tight text-title">{translate({ key: 'admin.manageTitle' })}</div>
                <div className="text-sm font-medium text-common/80">{translate({ key: 'admin.manageSubtitle' })}</div>
              </div>
              <div className="rounded-full border border-correct/30 bg-correct/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-correct">
                {String(onlineCount)} {translate({ key: 'adminCameraManager.online' })}
              </div>
            </div>

            <div className="rounded-2xl border border-container2-border bg-container1 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon name="database" size="20px" customClasses="text-primary" />
                  <span className="text-lg font-bold text-title">{translate({ key: 'adminManage.totalStorageUsage' })}</span>
                </div>
                <span className="text-sm font-bold text-primary">{String(simulatedStorageUsagePercent)}%</span>
              </div>

              <div className="mt-4 h-3 w-full overflow-hidden rounded-full border border-container2-border bg-container2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${String(simulatedStorageUsagePercent)}%` }} />
              </div>

              <div className="mt-4 flex items-center justify-between text-xs font-semibold text-common/80">
                <div className="flex flex-col">
                  <span>{translate({ key: 'adminManage.utilized' })}</span>
                  <span className="text-sm font-bold text-title">{simulatedStorageUsedTb}TB</span>
                </div>
                <div className="flex flex-col items-end">
                  <span>{translate({ key: 'adminManage.remaining' })}</span>
                  <span className="text-sm font-bold text-title">{remainingStorageTb}TB</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-1">
              <div className="text-xl font-bold text-title">{translate({ key: 'adminManage.activeCameraNodes' })}</div>
              <button
                className="rounded-lg border border-container2-border bg-container2 px-3 py-1.5 text-xs font-semibold text-title"
                onClick={() => {
                  void fetchCameraCatalog();
                }}
                type="button"
              >
                <div className="flex items-center gap-1">
                  <Icon name="refresh" size="14px" customClasses="text-common" />
                  <span>{translate({ key: 'adminManage.filterStatus' })}</span>
                </div>
              </button>
            </div>

            <Dropdown
              className="w-full"
              items={filterItems}
              onChange={(item) => {
                setCameraFilter(item.value as CameraFilter);
              }}
              placeholder={translate({ key: 'adminManage.filterStatus' })}
              value={selectedFilterItem}
            />

            {loadingCatalog && (
              <div className="animate-pulse rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common">
                {translate({ key: 'adminCameraManager.loading' })}
              </div>
            )}

            {!loadingCatalog && cameraViewModels.length === 0 && (
              <div className="rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common">
                {translate({ key: 'adminCameraManager.empty' })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              {!loadingCatalog && cameraViewModels.map((item) => {
                return (
                  <button
                    className={`w-full rounded-xl border p-4 text-left shadow-sm transition-all active:scale-[0.99] ${item.isOffline ? 'border-wrong/35 bg-container1' : 'border-container2-border bg-container1'}`}
                    key={item.camera.id}
                    onClick={() => {
                      openEditPanel(item.camera);
                    }}
                    type="button"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-container2-border bg-container2">
                        <img alt="" className={`h-full w-full object-cover ${item.isOffline ? 'grayscale opacity-65' : ''}`} src={item.previewSource} />
                        {!item.isOffline && (
                          <div className="absolute left-1 top-1 rounded bg-title/80 px-1 text-[8px] font-bold uppercase tracking-wide text-background">
                            {translate({ key: 'dashboard.live' })}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-base font-bold text-title">{item.camera.name}</div>
                        <div className="truncate font-mono text-xs font-medium text-common/80">{item.camera.cameraIp}</div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-common/80">
                          <div className="flex items-center gap-1">
                            <Icon name={item.isOffline ? 'warning' : 'schedule'} size="13px" />
                            <span>{item.uptime}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Icon name="network_check" size="13px" />
                            <span>{String(item.latencyMs)}ms</span>
                          </div>
                        </div>
                      </div>

                      <div className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${item.isOffline ? 'border-wrong/30 bg-wrong/10 text-wrong' : 'border-correct/30 bg-correct/10 text-correct'}`}>
                        {item.isOffline
                          ? translate({ key: 'adminCameraManager.offline' })
                          : translate({ key: 'adminCameraManager.online' })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="hidden [@container(min-width:72rem)]:block">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="flex max-w-2xl flex-col gap-2">
                <div className="text-4xl font-black tracking-tight text-title">{translate({ key: 'admin.manageTitle' })}</div>
                <div className="text-base font-medium text-common/80">{translate({ key: 'admin.manageSubtitle' })}</div>
              </div>

              <button
                className="flex h-12 items-center gap-2 rounded-xl border border-primary-border bg-primary px-6 text-sm font-bold text-title-primary shadow-sm transition-all hover:bg-primary-hover"
                onClick={openCreatePanel}
                type="button"
              >
                <Icon name="add_a_photo" size="18px" />
                <span>{translate({ key: 'adminManage.addCamera' })}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-2xl border border-container2-border bg-container1 p-6 shadow-sm lg:col-span-2">
                <div className="mb-5 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-common/80">{translate({ key: 'adminManage.totalStorageUsage' })}</div>
                    <div className="mt-1 text-4xl font-black text-title">
                      {simulatedStorageUsedTb}TB <span className="text-xl font-medium text-common/80">/ {String(storageCapacityTb)}TB</span>
                    </div>
                  </div>
                  <Icon name="database" size="30px" customClasses="text-primary" />
                </div>

                <div className="h-4 w-full overflow-hidden rounded-full border border-container2-border bg-container2">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${String(simulatedStorageUsagePercent)}%` }} />
                </div>

                <div className="mt-4 flex items-center justify-between text-sm font-semibold">
                  <span className="text-primary">{String(simulatedStorageUsagePercent)}% {translate({ key: 'adminManage.utilized' })}</span>
                  <span className="text-common/80">{remainingStorageTb}TB {translate({ key: 'adminManage.remaining' })}</span>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-5 rounded-2xl border border-container2-border bg-container1 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-correct/40 bg-correct/10">
                    <Icon name="check_circle" size="18px" customClasses="text-correct" />
                  </div>
                  <div>
                    <div className="text-3xl font-black text-title">{String(onlineCount)}</div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-common/80">{translate({ key: 'adminManage.camerasOnline' })}</div>
                  </div>
                </div>

                <div className="h-px bg-container2-border" />

                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-wrong/40 bg-wrong/10">
                    <Icon name="error" size="18px" customClasses="text-wrong" />
                  </div>
                  <div>
                    <div className="text-3xl font-black text-title">{String(offlineCount)}</div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-common/80">{translate({ key: 'adminManage.nodesOffline' })}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="text-2xl font-bold text-title">{translate({ key: 'adminManage.activeCameraNodes' })}</div>
              <div className="flex items-center gap-3">
                <Dropdown
                  items={filterItems}
                  onChange={(item) => {
                    setCameraFilter(item.value as CameraFilter);
                  }}
                  placeholder={translate({ key: 'adminManage.filterStatus' })}
                  size="md"
                  value={selectedFilterItem}
                />
                <button
                  className="flex h-10 items-center gap-1 rounded-lg border border-container2-border bg-container2 px-3 text-sm font-semibold text-title"
                  onClick={() => {
                    void fetchCameraCatalog();
                  }}
                  type="button"
                >
                  <Icon name="refresh" size="15px" customClasses="text-common" />
                  <span>{translate({ key: 'adminManage.filterStatus' })}</span>
                </button>
              </div>
            </div>

            {loadingCatalog && (
              <div className="animate-pulse rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common">
                {translate({ key: 'adminCameraManager.loading' })}
              </div>
            )}

            {!loadingCatalog && cameraViewModels.length === 0 && (
              <div className="rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common">
                {translate({ key: 'adminCameraManager.empty' })}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {!loadingCatalog && cameraViewModels.map((item) => {
                return (
                  <button
                    className={`group flex w-full flex-col gap-5 rounded-2xl border p-5 text-left shadow-sm transition-all md:flex-row md:items-center ${item.isOffline ? 'border-wrong/35 bg-container1' : 'border-container2-border bg-container1 hover:bg-container1-hover'}`}
                    key={item.camera.id}
                    onClick={() => {
                      openEditPanel(item.camera);
                    }}
                    type="button"
                  >
                    <div className="relative h-28 w-full overflow-hidden rounded-xl border border-container2-border bg-container2 md:w-48">
                      <img alt="" className={`h-full w-full object-cover transition-all ${item.isOffline ? 'grayscale opacity-60' : 'grayscale group-hover:grayscale-0'}`} src={item.previewSource} />
                      <div className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${item.isOffline ? 'bg-wrong text-title-primary' : 'bg-correct text-title-primary'}`}>
                        {item.isOffline
                          ? translate({ key: 'adminCameraManager.offline' })
                          : translate({ key: 'dashboard.live' })}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <div className="truncate text-lg font-bold text-title">{item.camera.name}</div>
                      </div>
                      <div className="truncate font-mono text-sm text-common/80">{item.camera.cameraIp}</div>

                      <div className="mt-2 flex items-center gap-4 text-xs text-common/80">
                        <div className="flex items-center gap-1">
                          <Icon name={item.isOffline ? 'warning' : 'schedule'} size="14px" />
                          <span>{translate({ key: 'dashboard.uptime' })}: {item.uptime}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Icon name="network_check" size="14px" />
                          <span>{String(item.latencyMs)}ms</span>
                        </div>
                      </div>

                      {item.isOffline && (
                        <div className="mt-2 text-xs font-semibold text-wrong">{translate({ key: 'adminManage.connectionLost' })}</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 md:flex-col md:items-end">
                      <div className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${item.isOffline ? 'border-wrong/30 bg-wrong/10 text-wrong' : 'border-correct/30 bg-correct/10 text-correct'}`}>
                        {item.isOffline
                          ? translate({ key: 'adminCameraManager.offline' })
                          : translate({ key: 'adminCameraManager.online' })}
                      </div>
                      <Icon name="edit_square" size="18px" customClasses="text-common" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <button
        className="fixed bottom-24 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-xl border border-primary-border bg-primary text-title-primary shadow-lg md:hidden"
        onClick={openCreatePanel}
        type="button"
      >
        <Icon name="add" size="28px" customClasses="text-title-primary" />
      </button>

      {panelOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm md:items-center md:p-6">
          <button
            className="absolute inset-0"
            onClick={() => {
              setPanelOpen(false);
            }}
            type="button"
          />

          <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-t-2xl border border-container2-border bg-container1 shadow-2xl md:rounded-2xl">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (panelMode === 'create') {
                  void createCamera();
                  return;
                }
                void updateCamera();
              }}
            >
              <div className="flex items-start justify-between gap-4 border-b border-container2-border px-6 pb-4 pt-5">
                <div>
                  <div className="text-2xl font-black tracking-tight text-title">
                    {panelMode === 'create'
                      ? translate({ key: 'adminManage.newCameraConfiguration' })
                      : translate({ key: 'adminManage.editCameraConfiguration' })}
                  </div>
                  <div className="mt-1 text-sm text-common/80">{translate({ key: 'adminManage.configSubtitle' })}</div>
                </div>
                <button
                  className="rounded-full p-2 text-common hover:bg-container2"
                  onClick={() => {
                    setPanelOpen(false);
                  }}
                  type="button"
                >
                  <Icon name="close" size="18px" />
                </button>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-common/80">{translate({ key: 'adminCameraManager.name' })}</label>
                    <div className="flex items-center gap-2 border-b-2 border-container2-border pb-2">
                      <Icon name="photo_camera" size="18px" customClasses="text-common" />
                      <input
                        className="w-full border-none bg-transparent p-0 text-sm font-medium text-title outline-none"
                        onChange={(event) => {
                          setForm((previous) => ({ ...previous, name: event.target.value }));
                        }}
                        placeholder={translate({ key: 'adminCameraManager.namePlaceholder' })}
                        value={form.name}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-common/80">{translate({ key: 'adminCameraManager.slug' })}</label>
                    <div className="flex items-center gap-2 border-b-2 border-container2-border pb-2">
                      <Icon name="link" size="18px" customClasses="text-common" />
                      <input
                        className="w-full border-none bg-transparent p-0 text-sm font-medium text-title outline-none"
                        onChange={(event) => {
                          setForm((previous) => ({ ...previous, slug: event.target.value }));
                        }}
                        placeholder={translate({ key: 'adminCameraManager.slugPlaceholder' })}
                        value={form.slug}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-common/80">{translate({ key: 'adminCameraManager.cameraIp' })}</label>
                  <div className="flex items-center gap-2 border-b-2 border-container2-border pb-2">
                    <Icon name="hub" size="18px" customClasses="text-common" />
                    <input
                      className="w-full border-none bg-transparent p-0 text-sm font-medium text-title outline-none"
                      onChange={(event) => {
                        setForm((previous) => ({ ...previous, cameraIp: event.target.value }));
                      }}
                      placeholder={translate({ key: 'adminCameraManager.cameraIpPlaceholder' })}
                      value={form.cameraIp}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-common/80">{translate({ key: 'adminCameraManager.targetFps' })}</label>
                    <div className="flex items-center gap-2 border-b-2 border-container2-border pb-2">
                      <Icon name="speed" size="18px" customClasses="text-common" />
                      <input
                        className="w-full border-none bg-transparent p-0 text-sm font-medium text-title outline-none"
                        inputMode="numeric"
                        max={60}
                        min={0}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value, 10);
                          if (!Number.isFinite(parsed)) {
                            return;
                          }
                          // 0 = uncapped (sensor's native max). Negative inputs are
                          // a UX shortcut for the same thing — normalize to 0.
                          const next = parsed < 0 ? 0 : parsed;
                          setForm((previous) => ({
                            ...previous,
                            targetFps: next,
                          }));
                        }}
                        type="number"
                        value={String(form.targetFps)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-widest text-common/80">{translate({ key: 'adminCameraManager.quality' })}</label>
                    <Dropdown
                      items={qualityItems}
                      onChange={(item) => {
                        setForm((previous) => ({ ...previous, quality: item.value as Quality }));
                      }}
                      value={selectedQualityItem}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-container2-border bg-container2 px-4 py-3">
                  <div>
                    <div className="text-sm font-bold text-title">{translate({ key: 'adminManage.disableFeed' })}</div>
                    <div className="text-xs text-common/80">{translate({ key: 'adminManage.disableFeedHint' })}</div>
                  </div>

                  <button
                    className={`h-6 w-11 rounded-full border transition-colors ${disableFeed ? 'border-wrong bg-wrong/90' : 'border-container2-border bg-container1'}`}
                    onClick={() => {
                      setDisableFeed((previous) => !previous);
                    }}
                    type="button"
                  >
                    <span className={`block h-4 w-4 rounded-full bg-title-primary transition-transform ${disableFeed ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-container2-border bg-container2/40 px-6 py-4 md:flex-row md:items-center md:justify-end">
                {panelMode === 'edit' && (
                  <button
                    className="mr-auto flex items-center justify-center gap-1 rounded-xl px-4 py-2 text-sm font-bold text-wrong transition-colors hover:bg-wrong/10 disabled:opacity-60"
                    disabled={deletingCamera || savingCamera}
                    onClick={() => {
                      void deleteCamera();
                    }}
                    type="button"
                  >
                    <Icon name="delete" size="18px" customClasses="text-wrong" />
                    <span>{translate({ key: 'adminManage.deleteCamera' })}</span>
                  </button>
                )}

                <button
                  className="rounded-xl px-5 py-2 text-sm font-bold text-common hover:bg-container2"
                  disabled={savingCamera || deletingCamera}
                  onClick={() => {
                    setPanelOpen(false);
                  }}
                  type="button"
                >
                  {translate({ key: 'confirm.cancel' })}
                </button>

                <button
                  className="rounded-xl border border-primary-border bg-primary px-6 py-2 text-sm font-bold text-title-primary shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-60"
                  disabled={savingCamera || deletingCamera}
                  type="submit"
                >
                  {panelMode === 'create'
                    ? translate({ key: 'adminCameraManager.createButton' })
                    : translate({ key: 'adminManage.saveCamera' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
