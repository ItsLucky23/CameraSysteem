import { useCallback, useEffect, useMemo, useState } from 'react';

import { backendUrl, sessionBasedToken } from 'config';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';
import tryCatch from 'shared/tryCatch';

import Chip from 'src/_components/ui/Chip';
import InfoPopover from 'src/_components/InfoPopover';
import MaterialIcon from 'src/_components/ui/MaterialIcon';
import PageTopBar from 'src/_components/ui/PageTopBar';
import StatusDot from 'src/_components/ui/StatusDot';

export const template = 'aperture';

type Quality = 'low' | 'medium' | 'high';

interface CatalogThumbnail {
  jpegBase64: string;
  capturedAt: string;
}

interface CameraCatalogItem {
  id: string;
  slug: string;
  name: string;
  cameraIp: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  targetFps: number;
  quality: Quality;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  bitrateBps: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  thumbnail: CatalogThumbnail | null;
  activeRecording: { recordingId: string; startedAt: string } | null;
}

// Allowed resolutions mirror the server-side validators in
// updateCamera_v1.ts and createCamera_v1.ts. Keep these in sync.
const RESOLUTION_CHOICES: Array<{ width: number; height: number; label: string }> = [
  { width: 1920, height: 1080, label: '1920x1080' },
  { width: 1280, height: 720, label: '1280x720' },
  { width: 854, height: 480, label: '854x480' },
  { width: 640, height: 480, label: '640x480' },
];

const DEFAULT_FORM_WIDTH = 1920;
const DEFAULT_FORM_HEIGHT = 1080;
const DEFAULT_FORM_BITRATE_MBPS = 4;

// Presets bulk-set the five tunables at once. The user can still fine-tune
// after picking a preset; the active highlight just shows which preset (if any)
// the current form values exactly match.
interface StreamPreset {
  id: string;
  width: number;
  height: number;
  fps: number;
  mbps: number;
  quality: Quality;
}

const STREAM_PRESETS: StreamPreset[] = [
  { id: 'fpsOpt',     width: 1280, height: 720,  fps: 60, mbps: 4, quality: 'medium' },
  { id: 'qualityOpt', width: 1920, height: 1080, fps: 25, mbps: 8, quality: 'high'   },
  { id: 'bestOfBoth', width: 1280, height: 720,  fps: 50, mbps: 6, quality: 'medium' },
];

interface ThumbnailEntry {
  jpegBase64: string;
  capturedAt: string;
}

interface CameraViewModel {
  camera: CameraCatalogItem;
  thumbnailSource: string | null;
  isOffline: boolean;
  isRecording: boolean;
}

type CameraCatalogResponse =
  | { status: 'success'; cameras: CameraCatalogItem[] }
  | { status: 'error'; errorCode: string };

type CameraCreateResponse =
  | { status: 'success'; camera: CameraCatalogItem }
  | { status: 'error'; errorCode: string };

type CameraUpdateResponse =
  | { status: 'success'; camera: CameraCatalogItem }
  | { status: 'error'; errorCode: string };

type CameraDeleteResponse =
  | { status: 'success'; cameraId: string }
  | { status: 'error'; errorCode: string };

type ConfigMode = 'create' | 'edit';
type CameraFilter = 'all' | 'online' | 'offline';

const storageCapacityTb = 100;

export default function AdminPage() {
  const translate = useTranslator();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [savingCamera, setSavingCamera] = useState<boolean>(false);
  const [deletingCamera, setDeletingCamera] = useState<boolean>(false);
  const [cameraCatalog, setCameraCatalog] = useState<CameraCatalogItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<string, ThumbnailEntry>>(new Map());
  const [recordingCameraIds, setRecordingCameraIds] = useState<Set<string>>(new Set());

  const [cameraFilter, setCameraFilter] = useState<CameraFilter>('all');

  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [panelMode, setPanelMode] = useState<ConfigMode>('create');
  const [panelCameraId, setPanelCameraId] = useState<string | null>(null);

  const [form, setForm] = useState<{
    slug: string;
    name: string;
    cameraIp: string;
    targetFps: number;
    quality: Quality;
    resolutionWidth: number;
    resolutionHeight: number;
    bitrateMbps: number;
  }>({
    slug: '',
    name: '',
    cameraIp: '',
    targetFps: 15,
    quality: 'medium',
    resolutionWidth: DEFAULT_FORM_WIDTH,
    resolutionHeight: DEFAULT_FORM_HEIGHT,
    bitrateMbps: DEFAULT_FORM_BITRATE_MBPS,
  });

  const onlineCount = useMemo(() => cameraCatalog.filter((c) => c.isOnline).length, [cameraCatalog]);
  const offlineCount = useMemo(() => cameraCatalog.filter((c) => !c.isOnline).length, [cameraCatalog]);

  const simulatedStorageUsedTb = useMemo(() => {
    const value = (cameraCatalog.length * 2.9) + (onlineCount * 0.6);
    return value.toFixed(1);
  }, [cameraCatalog.length, onlineCount]);

  const simulatedStorageUsagePercent = useMemo(() => {
    const used = Number(simulatedStorageUsedTb);
    return Math.min(100, Math.round((used / storageCapacityTb) * 100));
  }, [simulatedStorageUsedTb]);

  const remainingStorageTb = useMemo(() => Math.max(0, storageCapacityTb - Number(simulatedStorageUsedTb)).toFixed(1), [simulatedStorageUsedTb]);

  const filteredCameraCatalog = useMemo(() => {
    if (cameraFilter === 'online') return cameraCatalog.filter((c) => c.isOnline);
    if (cameraFilter === 'offline') return cameraCatalog.filter((c) => !c.isOnline);
    return cameraCatalog;
  }, [cameraCatalog, cameraFilter]);

  const cameraViewModels = useMemo<CameraViewModel[]>(() => {
    return filteredCameraCatalog.map((camera) => {
      const thumbnail = thumbnails.get(camera.id);
      const thumbnailSource = thumbnail ? `data:image/jpeg;base64,${thumbnail.jpegBase64}` : null;
      return {
        camera,
        thumbnailSource,
        isOffline: !camera.isOnline,
        isRecording: recordingCameraIds.has(camera.id),
      };
    });
  }, [filteredCameraCatalog, thumbnails, recordingCameraIds]);

  const authorizedHeaders = useCallback((): Record<string, string> => {
    if (!sessionBasedToken) return {};
    const token = sessionStorage.getItem('token');
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, []);

  const fetchCameraCatalog = useCallback(async () => {
    setLoadingCatalog(true);

    const [requestError, response] = await tryCatch(async () => fetch(`${backendUrl}/api/admin/getCameraCatalog/v1`, {
      method: 'GET',
      headers: { ...authorizedHeaders() },
      credentials: 'include',
    }));

    if (requestError || !response) {
      setLoadingCatalog(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => response.json() as Promise<CameraCatalogResponse>);
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
    setThumbnails((previous) => {
      const next = new Map(previous);
      for (const camera of parsedBody.cameras) {
        if (camera.thumbnail) {
          next.set(camera.id, {
            jpegBase64: camera.thumbnail.jpegBase64,
            capturedAt: camera.thumbnail.capturedAt,
          });
        }
      }
      return next;
    });
    setRecordingCameraIds(() => {
      const next = new Set<string>();
      for (const camera of parsedBody.cameras) {
        if (camera.activeRecording) next.add(camera.id);
      }
      return next;
    });
    setLoadingCatalog(false);
  }, [authorizedHeaders]);

  useEffect(() => { void fetchCameraCatalog(); }, [fetchCameraCatalog]);

  useEffect(() => {
    const roomCode = 'cameras-overview';
    void joinRoom(roomCode);
    return () => { void leaveRoom(roomCode); };
  }, []);

  useEffect(() => {
    const unsubscribeState = upsertSyncEventCallback({
      name: 'cameras/cameraStateUpdated',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setCameraCatalog((previous) => previous.map((camera) => {
          if (camera.id !== serverOutput.cameraId) return camera;
          return {
            ...camera,
            ...(typeof serverOutput.patch.isOnline === 'boolean' ? { isOnline: serverOutput.patch.isOnline } : {}),
            ...(serverOutput.patch.mode === undefined ? {} : { mode: serverOutput.patch.mode }),
          };
        }));
      },
    });

    const unsubscribeThumbnail = upsertSyncEventCallback({
      name: 'cameras/thumbnailUpdated',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setThumbnails((previous) => {
          const next = new Map(previous);
          next.set(serverOutput.cameraId, {
            jpegBase64: serverOutput.jpegBase64,
            capturedAt: serverOutput.capturedAt,
          });
          return next;
        });
      },
    });

    const unsubscribeRecording = upsertSyncEventCallback({
      name: 'cameras/recordingStatus',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setRecordingCameraIds((previous) => {
          const next = new Set(previous);
          if (serverOutput.recordingId) next.add(serverOutput.cameraId);
          else next.delete(serverOutput.cameraId);
          return next;
        });
      },
    });

    return () => {
      unsubscribeState();
      unsubscribeThumbnail();
      unsubscribeRecording();
    };
  }, [upsertSyncEventCallback]);

  const createCamera = useCallback(async () => {
    const payload = {
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      cameraIp: form.cameraIp.trim(),
      targetFps: form.targetFps,
      quality: form.quality,
      resolutionWidth: form.resolutionWidth,
      resolutionHeight: form.resolutionHeight,
      bitrateBps: Math.round(form.bitrateMbps * 1_000_000),
    };

    if (!payload.slug || !payload.name || !payload.cameraIp) {
      notify.error({ key: 'camera.invalidInput' });
      return;
    }

    setSavingCamera(true);
    const [requestError, response] = await tryCatch(async () => fetch(`${backendUrl}/api/admin/createCamera/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authorizedHeaders() },
      credentials: 'include',
      body: JSON.stringify(payload),
    }));

    if (requestError || !response) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => response.json() as Promise<CameraCreateResponse>);
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

    setCameraCatalog((previous) => [parsedBody.camera, ...previous].toSorted((a, b) => a.name.localeCompare(b.name)));
    setForm({
      slug: '',
      name: '',
      cameraIp: '',
      targetFps: 15,
      quality: 'medium',
      resolutionWidth: DEFAULT_FORM_WIDTH,
      resolutionHeight: DEFAULT_FORM_HEIGHT,
      bitrateMbps: DEFAULT_FORM_BITRATE_MBPS,
    });
    setPanelOpen(false);
    setSavingCamera(false);
    notify.success({ key: 'adminCameraManager.created' });
  }, [authorizedHeaders, form]);

  const updateCamera = useCallback(async () => {
    if (!panelCameraId) return;
    const payload = {
      cameraId: panelCameraId,
      slug: form.slug.trim().toLowerCase(),
      name: form.name.trim(),
      cameraIp: form.cameraIp.trim(),
      targetFps: form.targetFps,
      quality: form.quality,
      resolutionWidth: form.resolutionWidth,
      resolutionHeight: form.resolutionHeight,
      bitrateBps: Math.round(form.bitrateMbps * 1_000_000),
    };

    if (!payload.slug || !payload.name || !payload.cameraIp) {
      notify.error({ key: 'camera.invalidInput' });
      return;
    }

    setSavingCamera(true);
    const [requestError, response] = await tryCatch(async () => fetch(`${backendUrl}/api/admin/updateCamera/v1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authorizedHeaders() },
      credentials: 'include',
      body: JSON.stringify(payload),
    }));

    if (requestError || !response) {
      setSavingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => response.json() as Promise<CameraUpdateResponse>);
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
      .toSorted((a, b) => a.name.localeCompare(b.name)));

    setSavingCamera(false);
    setPanelOpen(false);
    notify.success({ key: 'adminManage.saved' });
  }, [authorizedHeaders, form, panelCameraId]);

  const deleteCamera = useCallback(async () => {
    if (!panelCameraId) return;
    setDeletingCamera(true);
    const [requestError, response] = await tryCatch(async () => fetch(`${backendUrl}/api/admin/deleteCamera/v1`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authorizedHeaders() },
      credentials: 'include',
      body: JSON.stringify({ cameraId: panelCameraId }),
    }));

    if (requestError || !response) {
      setDeletingCamera(false);
      notify.error({ key: 'camera.unexpectedError' });
      return;
    }

    const [parseError, parsedBody] = await tryCatch(async () => response.json() as Promise<CameraDeleteResponse>);
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
    setForm({
      slug: '',
      name: '',
      cameraIp: '',
      targetFps: 15,
      quality: 'medium',
      resolutionWidth: DEFAULT_FORM_WIDTH,
      resolutionHeight: DEFAULT_FORM_HEIGHT,
      bitrateMbps: DEFAULT_FORM_BITRATE_MBPS,
    });
    setPanelOpen(true);
  }, []);

  const openEditPanel = useCallback((camera: CameraCatalogItem) => {
    setPanelMode('edit');
    setPanelCameraId(camera.id);
    // Legacy DB rows can have null resolution/bitrate. Mirror the server
    // fallbacks so the form opens with sensible values.
    const initialWidth = camera.resolutionWidth ?? DEFAULT_FORM_WIDTH;
    const initialHeight = camera.resolutionHeight ?? DEFAULT_FORM_HEIGHT;
    const initialMbps = camera.bitrateBps !== null
      ? Math.round((camera.bitrateBps / 1_000_000) * 10) / 10
      : DEFAULT_FORM_BITRATE_MBPS;
    setForm({
      slug: camera.slug,
      name: camera.name,
      cameraIp: camera.cameraIp,
      targetFps: camera.targetFps,
      quality: camera.quality,
      resolutionWidth: initialWidth,
      resolutionHeight: initialHeight,
      bitrateMbps: initialMbps,
    });
    setPanelOpen(true);
  }, []);

  const filterTabs: { value: CameraFilter; label: string }[] = [
    { value: 'all', label: translate({ key: 'aperture.admin.filterAll' }) },
    { value: 'online', label: translate({ key: 'aperture.admin.filterOnline' }) },
    { value: 'offline', label: translate({ key: 'aperture.admin.filterOffline' }) },
  ];

  const qualityChoices: Quality[] = ['low', 'medium', 'high'];
  const qualityLabel = (q: Quality): string => translate({ key: `aperture.monitor.quality${q.charAt(0).toUpperCase()}${q.slice(1)}` });

  // Match the form against the preset list. Equality on all five tunables;
  // null when no preset matches (fine-tuned camera, or fresh defaults).
  const activePresetId = useMemo<string | null>(() => {
    const match = STREAM_PRESETS.find((preset) => (
      preset.width === form.resolutionWidth
      && preset.height === form.resolutionHeight
      && preset.fps === form.targetFps
      && preset.mbps === form.bitrateMbps
      && preset.quality === form.quality
    ));
    return match ? match.id : null;
  }, [form.resolutionWidth, form.resolutionHeight, form.targetFps, form.bitrateMbps, form.quality]);

  const applyPreset = (preset: StreamPreset): void => {
    setForm((p) => ({
      ...p,
      resolutionWidth: preset.width,
      resolutionHeight: preset.height,
      targetFps: preset.fps,
      bitrateMbps: preset.mbps,
      quality: preset.quality,
    }));
  };

  const presetSubLabel = (preset: StreamPreset): string =>
    `${String(preset.width)}x${String(preset.height)} - ${String(preset.fps)} fps - ${preset.mbps.toFixed(1)} Mbps`;

  const presetMainLabel = (presetId: string): string =>
    translate({ key: `aperture.admin.preset${presetId.charAt(0).toUpperCase()}${presetId.slice(1)}` });

  return (
    <main className="thin-scroll h-full w-full overflow-y-auto bg-background">
      <PageTopBar
        eyebrow={translate({ key: 'aperture.admin.eyebrow' })}
        title={translate({ key: 'aperture.admin.title' })}
        subtitle={translate({ key: 'aperture.admin.subtitle' })}
        actions={
          <>
            <button type="button" className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover">
              <MaterialIcon name="download" size={16} />
              {translate({ key: 'aperture.admin.export' })}
            </button>
            <button
              type="button"
              onClick={openCreatePanel}
              className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3.5 py-2 text-[13px] font-medium text-title-primary transition-colors hover:bg-primary-hover"
            >
              <MaterialIcon name="add_a_photo" size={16} />
              {translate({ key: 'aperture.admin.addCamera' })}
            </button>
          </>
        }
      />

      <section className="px-9 pb-5">
        <div className="grid grid-cols-1 gap-7 rounded-2xl border border-container1-border bg-container1 p-6 md:grid-cols-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.storage' })}</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-display text-[38px] text-title">{simulatedStorageUsedTb} TB</span>
              <span className="text-sm text-muted">{translate({ key: 'aperture.admin.storageOf' }).replace('{{capacity}}', `${String(storageCapacityTb)} TB`)}</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-container2">
              <div className="h-full rounded-full bg-primary" style={{ width: `${String(simulatedStorageUsagePercent)}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11.5px] text-muted">
              <span>{translate({ key: 'aperture.admin.storageUtilized' }).replace('{{percent}}', String(simulatedStorageUsagePercent))}</span>
              <span>{translate({ key: 'aperture.admin.storageRemaining' }).replace('{{remaining}}', `${remainingStorageTb} TB`)}</span>
            </div>
          </div>
          <div className="border-l border-container1-border pl-7">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.camerasOnline' })}</div>
            <div className="font-display mt-2 text-[38px] text-correct">{String(onlineCount)}</div>
            <div className="mt-1 text-xs text-muted">{translate({ key: 'aperture.admin.camerasOnlineSub' }).replace('{{total}}', String(cameraCatalog.length))}</div>
          </div>
          <div className="border-l border-container1-border pl-7">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.nodesOffline' })}</div>
            <div className="font-display mt-2 text-[38px] text-wrong">{String(offlineCount)}</div>
            <div className="mt-1 text-xs text-muted">{translate({ key: 'aperture.admin.nodesOfflineSub' })}</div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-between px-9 pb-2 pt-3">
        <h2 className="font-display text-[22px] text-title">{translate({ key: 'aperture.admin.activeNodes' })}</h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-[10px] bg-container2 p-1">
            {filterTabs.map((tab) => {
              const active = cameraFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => { setCameraFilter(tab.value); }}
                  className={`rounded-[7px] border px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { void fetchCameraCatalog(); }}
            className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
          >
            <MaterialIcon name="refresh" size={15} />
            {translate({ key: 'aperture.admin.refresh' })}
          </button>
        </div>
      </section>

      <section className="px-9 pb-10 pt-3">
        <div className="overflow-hidden rounded-2xl border border-container1-border bg-container1">
          <div className="grid items-center gap-4 border-b border-container1-border px-5 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted" style={{ gridTemplateColumns: '1.6fr 1fr 0.7fr 0.8fr 0.7fr 60px' }}>
            <div>{translate({ key: 'aperture.admin.headerCamera' })}</div>
            <div>{translate({ key: 'aperture.admin.headerAddress' })}</div>
            <div>{translate({ key: 'aperture.admin.headerQuality' })}</div>
            <div>{translate({ key: 'aperture.admin.headerFps' })}</div>
            <div>{translate({ key: 'aperture.admin.headerStatus' })}</div>
            <div></div>
          </div>

          {loadingCatalog && (
            <div className="px-5 py-4 text-sm text-muted">{translate({ key: 'adminCameraManager.loading' })}</div>
          )}

          {!loadingCatalog && cameraViewModels.length === 0 && (
            <div className="px-5 py-4 text-sm text-muted">{translate({ key: 'adminCameraManager.empty' })}</div>
          )}

          {!loadingCatalog && cameraViewModels.map((item, index) => (
            <div
              key={item.camera.id}
              className={`grid items-center gap-4 px-5 py-3 ${index < cameraViewModels.length - 1 ? 'border-b border-container1-border' : ''}`}
              style={{
                gridTemplateColumns: '1.6fr 1fr 0.7fr 0.8fr 0.7fr 60px',
                background: item.isOffline ? 'var(--color-wrong-soft)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="h-9 w-14 shrink-0 overflow-hidden rounded-md bg-container2">
                  {item.thumbnailSource ? (
                    <img
                      alt=""
                      src={item.thumbnailSource}
                      className="h-full w-full object-cover"
                      style={{ filter: item.isOffline ? 'grayscale(1) opacity(0.55)' : undefined }}
                    />
                  ) : (
                    <div className="cam-placeholder h-full w-full" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold text-title">{item.camera.name}</div>
                  <div className="font-mono text-[11px] text-muted">{item.camera.slug}</div>
                </div>
              </div>
              <div className="font-mono text-[12.5px] text-common">{item.camera.cameraIp}</div>
              <div className="text-xs uppercase text-common">{item.camera.quality}</div>
              <div className={`font-mono text-[12.5px] ${item.camera.targetFps > 0 ? 'text-title' : 'text-muted'}`}>
                {item.camera.targetFps > 0 ? String(item.camera.targetFps) : '—'}
              </div>
              <div>
                <Chip variant={item.isOffline ? 'wrong' : 'correct'}>
                  <StatusDot status={item.isOffline ? 'offline' : 'online'} pulse={!item.isOffline} />
                  {item.isOffline ? translate({ key: 'aperture.admin.statusOffline' }) : translate({ key: 'aperture.admin.statusOnline' })}
                  {item.isRecording && <span className="ml-1 text-wrong">·REC</span>}
                </Chip>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { openEditPanel(item.camera); }}
                  className="rounded-md p-1.5 text-common transition-colors hover:bg-container2"
                  aria-label={translate({ key: 'aperture.admin.edit' })}
                >
                  <MaterialIcon name="edit" size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {panelOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm md:items-center md:p-6">
          <button
            className="absolute inset-0"
            onClick={() => { setPanelOpen(false); }}
            type="button"
            aria-label="Close"
          />
          <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-t-2xl border border-container1-border bg-container1 shadow-2xl md:rounded-2xl">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (panelMode === 'create') void createCamera();
                else void updateCamera();
              }}
            >
              <div className="flex items-start justify-between gap-4 border-b border-container1-border px-6 pb-4 pt-5">
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {translate({ key: 'aperture.admin.eyebrow' })}
                  </div>
                  <div className="font-display mt-1 text-[26px] text-title">
                    {panelMode === 'create'
                      ? translate({ key: 'aperture.admin.configCreateTitle' })
                      : translate({ key: 'aperture.admin.configEditTitle' })}
                  </div>
                  <div className="mt-1 text-sm text-muted">{translate({ key: 'aperture.admin.configSubtitle' })}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setPanelOpen(false); }}
                  className="rounded-full p-2 text-common transition-colors hover:bg-container2"
                >
                  <MaterialIcon name="close" size={18} />
                </button>
              </div>

              <div className="max-h-[calc(100vh-220px)] space-y-5 overflow-y-auto px-6 py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldName' })}</label>
                    <input
                      className="h-[42px] rounded-[10px] border border-container1-border bg-container1 px-3.5 text-sm text-title outline-none transition-colors focus:border-primary"
                      value={form.name}
                      onChange={(event) => { setForm((p) => ({ ...p, name: event.target.value })); }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldSlug' })}</label>
                    <input
                      className="h-[42px] rounded-[10px] border border-container1-border bg-container1 px-3.5 font-mono text-sm text-title outline-none transition-colors focus:border-primary"
                      value={form.slug}
                      onChange={(event) => { setForm((p) => ({ ...p, slug: event.target.value })); }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldIp' })}</label>
                  <input
                    className="h-[42px] rounded-[10px] border border-container1-border bg-container1 px-3.5 font-mono text-sm text-title outline-none transition-colors focus:border-primary"
                    value={form.cameraIp}
                    onChange={(event) => { setForm((p) => ({ ...p, cameraIp: event.target.value })); }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.presetsLabel' })}</label>
                    <InfoPopover
                      title={translate({ key: 'aperture.admin.infoPresets.title' })}
                      body={
                        <>
                          <p>{translate({ key: 'aperture.admin.infoPresets.body1' })}</p>
                          <p>{translate({ key: 'aperture.admin.infoPresets.body2' })}</p>
                        </>
                      }
                    />
                  </div>
                  <div className="flex gap-1 rounded-[10px] bg-container2 p-1">
                    {STREAM_PRESETS.map((preset) => {
                      const active = activePresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => { applyPreset(preset); }}
                          className={`flex-1 flex flex-col items-center gap-0.5 rounded-[7px] border px-2 py-1.5 ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                        >
                          <span className="text-xs font-semibold">{presetMainLabel(preset.id)}</span>
                          <span className="text-[10.5px] font-mono text-muted">{presetSubLabel(preset)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldResolution' })}</label>
                    <InfoPopover
                      title={translate({ key: 'aperture.admin.infoResolution.title' })}
                      body={
                        <>
                          <p>{translate({ key: 'aperture.admin.infoResolution.body1' })}</p>
                          <p>{translate({ key: 'aperture.admin.infoResolution.body2' })}</p>
                          <p>{translate({ key: 'aperture.admin.infoResolution.bodyWideLens' })}</p>
                        </>
                      }
                    />
                  </div>
                  <div className="flex gap-1 rounded-[10px] bg-container2 p-1">
                    {RESOLUTION_CHOICES.map((option) => {
                      const active = form.resolutionWidth === option.width && form.resolutionHeight === option.height;
                      return (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => { setForm((p) => ({ ...p, resolutionWidth: option.width, resolutionHeight: option.height })); }}
                          className={`flex-1 rounded-[7px] border py-1.5 font-mono text-xs font-semibold ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldFps' })}</label>
                      <InfoPopover
                        title={translate({ key: 'aperture.admin.infoFps.title' })}
                        body={
                          <>
                            <p>{translate({ key: 'aperture.admin.infoFps.body1' })}</p>
                            <p>{translate({ key: 'aperture.admin.infoFps.bodyEdgeCase' })}</p>
                          </>
                        }
                      />
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      className="h-[42px] rounded-[10px] border border-container1-border bg-container1 px-3.5 font-mono text-sm text-title outline-none transition-colors focus:border-primary"
                      value={String(form.targetFps)}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        if (!Number.isFinite(parsed)) return;
                        const next = Math.max(0, parsed);
                        setForm((p) => ({ ...p, targetFps: next }));
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldQuality' })}</label>
                      <InfoPopover
                        title={translate({ key: 'aperture.admin.infoQuality.title' })}
                        body={<p>{translate({ key: 'aperture.admin.infoQuality.body1' })}</p>}
                      />
                    </div>
                    <div className="flex gap-1 rounded-[10px] bg-container2 p-1">
                      {qualityChoices.map((q) => {
                        const active = form.quality === q;
                        return (
                          <button
                            key={q}
                            type="button"
                            onClick={() => { setForm((p) => ({ ...p, quality: q })); }}
                            className={`flex-1 rounded-[7px] border py-1.5 text-xs font-semibold ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                          >
                            {qualityLabel(q)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.admin.fieldBitrateMbps' })}</label>
                    <InfoPopover
                      title={translate({ key: 'aperture.admin.infoBitrate.title' })}
                      body={
                        <>
                          <p>{translate({ key: 'aperture.admin.infoBitrate.body1' })}</p>
                          <p>{translate({ key: 'aperture.admin.infoBitrate.bodyEdgeCase' })}</p>
                        </>
                      }
                    />
                  </div>
                  <input
                    type="number"
                    min={0.5}
                    max={12}
                    step={0.1}
                    className="h-[42px] rounded-[10px] border border-container1-border bg-container1 px-3.5 font-mono text-sm text-title outline-none transition-colors focus:border-primary"
                    value={String(form.bitrateMbps)}
                    onChange={(event) => {
                      const parsed = Number.parseFloat(event.target.value);
                      if (!Number.isFinite(parsed)) return;
                      const clamped = Math.min(12, Math.max(0.5, parsed));
                      // Round to one decimal so the input stays in sync with the preset matcher.
                      setForm((p) => ({ ...p, bitrateMbps: Math.round(clamped * 10) / 10 }));
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-container1-border bg-container2/40 px-6 py-4 md:flex-row md:items-center md:justify-end">
                {panelMode === 'edit' && (
                  <button
                    type="button"
                    onClick={() => { void deleteCamera(); }}
                    disabled={deletingCamera || savingCamera}
                    className="mr-auto inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold text-wrong transition-colors hover:bg-wrong-soft disabled:opacity-50"
                  >
                    <MaterialIcon name="delete" size={16} />
                    {translate({ key: 'aperture.admin.deleteCamera' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setPanelOpen(false); }}
                  disabled={savingCamera || deletingCamera}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-transparent bg-transparent px-3.5 py-2 text-[13px] font-medium text-common transition-colors hover:bg-container2 disabled:opacity-50"
                >
                  {translate({ key: 'aperture.admin.cancel' })}
                </button>
                <button
                  type="submit"
                  disabled={savingCamera || deletingCamera}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-5 py-2 text-[13px] font-semibold text-title-primary transition-colors hover:bg-primary-hover disabled:opacity-60"
                >
                  {panelMode === 'create' ? translate({ key: 'aperture.admin.createCamera' }) : translate({ key: 'aperture.admin.saveCamera' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
