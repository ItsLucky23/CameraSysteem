import { useCallback, useEffect, useMemo, useState } from 'react';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';
import useRouter from 'src/_components/Router';
import CameraThumb from 'src/_components/ui/CameraThumb';
import Chip from 'src/_components/ui/Chip';
import MaterialIcon from 'src/_components/ui/MaterialIcon';
import PageTopBar from 'src/_components/ui/PageTopBar';
import StatusDot from 'src/_components/ui/StatusDot';

export const template = 'aperture';

interface CameraListItem {
  id: string;
  slug: string;
  name: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  irMode: 'off' | 'on' | 'auto';
  canPreview: boolean;
  canControl: boolean;
  lastSeenAt: string | null;
  activeRecording: { recordingId: string; startedAt: string } | null;
}

interface ThumbnailEntry {
  jpegBase64: string;
  capturedAt: string;
}

interface CameraViewModel {
  camera: CameraListItem;
  thumbnailSource: string | null;
  isOffline: boolean;
  isRecording: boolean;
  uptime: string;
  fps: number;
}

const formatDuration = (durationMs: number): string => {
  const safe = Math.max(0, durationMs);
  const totalMinutes = Math.floor(safe / 60_000);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
};

export default function DashboardPage() {
  const translate = useTranslator();
  const router = useRouter();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loading, setLoading] = useState<boolean>(true);
  const [cameras, setCameras] = useState<CameraListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<string, ThumbnailEntry>>(new Map());
  const [recordingCameraIds, setRecordingCameraIds] = useState<Set<string>>(new Set());

  const loadCameras = useCallback(async () => {
    setLoading(true);
    const response = await apiRequest({
      name: 'cameras/getCameraList',
      version: 'v1',
      data: {},
    });

    if (response.status === 'error') {
      setLoading(false);
      notify.error({ key: response.errorCode });
      return;
    }

    setCameras(response.cameras);
    setThumbnails((previous) => {
      const next = new Map(previous);
      for (const camera of response.cameras) {
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
      for (const camera of response.cameras) {
        if (camera.activeRecording) {
          next.add(camera.id);
        }
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    const roomCode = 'cameras-overview';
    void joinRoom(roomCode);
    return () => {
      void leaveRoom(roomCode);
    };
  }, []);

  useEffect(() => {
    const unsubscribeState = upsertSyncEventCallback({
      name: 'cameras/cameraStateUpdated',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setCameras((previous) => previous.map((camera) => {
          if (camera.id !== serverOutput.cameraId) return camera;
          return {
            ...camera,
            ...(typeof serverOutput.patch.isOnline === 'boolean' ? { isOnline: serverOutput.patch.isOnline } : {}),
            ...(serverOutput.patch.mode === undefined ? {} : { mode: serverOutput.patch.mode }),
            ...(serverOutput.patch.irMode === undefined ? {} : { irMode: serverOutput.patch.irMode }),
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
          if (serverOutput.recordingId) {
            next.add(serverOutput.cameraId);
          } else {
            next.delete(serverOutput.cameraId);
          }
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

  const onlineCount = useMemo(() => cameras.filter((camera) => camera.isOnline).length, [cameras]);
  const offlineCount = useMemo(() => cameras.filter((camera) => !camera.isOnline).length, [cameras]);
  const recordingCount = recordingCameraIds.size;
  const uptimeAverage = useMemo(() => {
    if (cameras.length === 0) return '0.0%';
    return `${((onlineCount / cameras.length) * 100).toFixed(1)}%`;
  }, [cameras.length, onlineCount]);

  const cameraViewModels = useMemo<CameraViewModel[]>(() => {
    return cameras.map((camera) => {
      const parsedLastSeenAt = camera.lastSeenAt ? Date.parse(camera.lastSeenAt) : Number.NaN;
      const hasLastSeen = Number.isFinite(parsedLastSeenAt);
      const uptimeMs = hasLastSeen ? Date.now() - parsedLastSeenAt : 0;
      const isOffline = !camera.isOnline || camera.mode === 'off';
      const thumbnail = thumbnails.get(camera.id);
      const thumbnailSource = thumbnail ? `data:image/jpeg;base64,${thumbnail.jpegBase64}` : null;
      let fpsHash = 0;
      for (let charIdx = 0; charIdx < camera.id.length; charIdx += 1) {
        fpsHash += camera.id.codePointAt(charIdx) ?? 0;
      }
      const fps = isOffline ? 0 : 12 + (fpsHash % 19);
      return {
        camera,
        thumbnailSource,
        isOffline,
        isRecording: recordingCameraIds.has(camera.id),
        uptime: isOffline || !hasLastSeen ? '--' : formatDuration(uptimeMs),
        fps,
      };
    });
  }, [cameras, thumbnails, recordingCameraIds]);

  const openCamera = useCallback((cameraId: string, canPreview: boolean) => {
    if (!canPreview) return;
    void router(`/cameras/${cameraId}`);
  }, [router]);

  const storageDisplay = '78%';
  const storageSub = '1.2 TB / 1.5 TB';

  return (
    <main className="thin-scroll h-full w-full overflow-y-auto bg-background">
      <PageTopBar
        eyebrow={translate({ key: 'aperture.dashboard.eyebrow' })}
        title={translate({ key: 'aperture.dashboard.title' })}
        subtitle={translate({ key: 'aperture.dashboard.subtitle' })}
        actions={
          <>
            <button
              type="button"
              onClick={() => { void loadCameras(); }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
            >
              <MaterialIcon name="refresh" size={16} />
              {translate({ key: 'aperture.dashboard.refresh' })}
            </button>
            <button
              type="button"
              onClick={() => { void router('/admin'); }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3.5 py-2 text-[13px] font-medium text-title-primary transition-colors hover:bg-primary-hover"
            >
              <MaterialIcon name="add" size={16} />
              {translate({ key: 'aperture.dashboard.addCamera' })}
            </button>
          </>
        }
      />

      <section className="px-9 pb-6">
        <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-container1-border bg-container1 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: translate({ key: 'aperture.dashboard.statActiveFeeds' }),
              value: String(cameras.length),
              sub: translate({ key: 'aperture.dashboard.statActiveFeedsSub' }).replace('{{online}}', String(onlineCount)).replace('{{offline}}', String(offlineCount)),
              tone: 'text-title',
            },
            {
              label: translate({ key: 'aperture.dashboard.statRecording' }),
              value: String(recordingCount),
              sub: translate({ key: 'aperture.dashboard.statRecordingSub' }).replace('{{count}}', String(recordingCount)),
              tone: 'text-wrong',
            },
            {
              label: translate({ key: 'aperture.dashboard.statUptime' }),
              value: uptimeAverage,
              sub: translate({ key: 'aperture.dashboard.statUptimeSub' }),
              tone: 'text-correct',
            },
            {
              label: translate({ key: 'aperture.dashboard.statStorage' }),
              value: storageDisplay,
              sub: translate({ key: 'aperture.dashboard.statStorageSub' }).replace('{{used}}', '1.2 TB').replace('{{capacity}}', '1.5 TB'),
              tone: 'text-primary',
              fallbackSub: storageSub,
            },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className={`px-7 py-6 ${index < 3 ? 'border-b border-container1-border lg:border-b-0 lg:border-r' : ''}`}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{stat.label}</div>
              <div className={`font-display mt-1.5 text-[38px] leading-none ${stat.tone}`}>{stat.value}</div>
              <div className="mt-1 text-xs text-muted">{stat.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-end justify-between px-9 pb-2 pt-3">
        <div>
          <h2 className="font-display m-0 text-[22px] text-title">{translate({ key: 'aperture.dashboard.yourCameras' })}</h2>
          <p className="mt-1 text-sm text-muted">{translate({ key: 'aperture.dashboard.yourCamerasSub' })}</p>
        </div>
      </section>

      <section className="px-9 pb-10 pt-2">
        {loading && (
          <div className="rounded-2xl border border-container1-border bg-container1 px-5 py-4 text-sm text-muted">
            {translate({ key: 'cameras.loading' })}
          </div>
        )}

        {!loading && cameraViewModels.length === 0 && (
          <div className="rounded-2xl border border-container1-border bg-container1 px-5 py-4 text-sm text-muted">
            {translate({ key: 'cameras.empty' })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {!loading && cameraViewModels.map((item) => (
            <button
              key={item.camera.id}
              type="button"
              onClick={() => { openCamera(item.camera.id, item.camera.canPreview); }}
              disabled={!item.camera.canPreview}
              className="group flex flex-col overflow-hidden rounded-2xl border border-container1-border bg-container1 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CameraThumb
                src={item.thumbnailSource}
                status={item.isOffline ? 'offline' : 'online'}
                slug={item.camera.slug}
                height={160}
                rounded={0}
                rec={item.isRecording}
                liveLabel={translate({ key: 'aperture.dashboard.live' })}
                offlineLabel={translate({ key: 'cameras.statusOffline' })}
              />
              <div className="px-4 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-semibold text-title">{item.camera.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted">{item.camera.slug}</div>
                  </div>
                  {item.isRecording && (
                    <Chip variant="wrong">
                      <span className="h-1.5 w-1.5 rounded-full bg-wrong" />
                      {translate({ key: 'aperture.dashboard.rec' })}
                    </Chip>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-container1-border pt-3">
                  <div className="flex items-center gap-1.5 text-[11.5px] text-common">
                    <StatusDot status={item.isOffline ? 'offline' : 'online'} pulse={!item.isOffline} />
                    <span>{item.isOffline ? translate({ key: 'cameras.statusOffline' }) : item.uptime}</span>
                  </div>
                  <div className="font-mono text-[11px] text-muted">
                    {item.fps > 0
                      ? translate({ key: 'aperture.dashboard.fpsLabel' }).replace('{{fps}}', String(item.fps))
                      : '—'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
