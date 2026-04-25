import { useCallback, useEffect, useMemo, useState } from 'react';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';
import Icon from 'src/_components/Icon';
import useRouter from 'src/_components/Router';

export const template = 'ops';

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
  previewSource: string;
  thumbnailSource: string | null;
  isOffline: boolean;
  isRecording: boolean;
  statusKey: 'cameras.statusOnline' | 'cameras.statusOffline';
  recordingKey: 'dashboard.recordingActive' | 'dashboard.recordingPaused' | 'dashboard.recordingDisabled';
  uptime: string;
}

const cameraPreviewSources = [
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCbzPduZN1NL9trZqJD-Q8aKa_7koHU9XdV4qQynowtsjcSzaIEJaOrB_jRLbTVIPnMuTJcuSn9dlW4xCUKgBOPWIASkjc1dp9YZon0fLfrZBAYs242vZVA_li5fl4SZlH9rh5Vg-aLF7-UL5rMxgjVZZakA32OKbKpo6KOvJfWRLHR9vd6LpcDbXlm7q4KDU2SyYRb059VsLZlwXMiyjGY_0laAIVObnFdUD-JSbBTu_oUt-s0c4KKfbnrQXZsGfNTWqkTdeNACJ8',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBmlYstIprhvGMELiVCiWHFDQnObtlWZBFiDYltghxLcpTECq9z5rUaFwqBtPhwzLMZkVy5naBfPm_ppx3nEj_fOAN13wtprBZDD2PaJbSbxQFTGZyUvx9mianPlBRE9MXp_0DuU1LcrwNrhGpdFZDue3uOFDvJ0wD14hfoYf1wOsbPrvyA0QNJK0DYqgJbeUL5YMrCqnpWO_udMeulxDliXBw8l3Vlkf7ptDIjWX36emvsClJVJaDpTG_APOuv9lES11czAuTDkMI',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBptm649nDGzGwRTIuSp_X2GZRo9DPrY0b0XCfkL31ukNfrOgpk173kaM2Z4LX9Q6BWcPQttBs31JNGkldm1c6ZtFOpCJYyZdiEFgsRYfjYa-rCjOuKqnRIUcLc5MeactPWt_awH9WTX8vQTcwdI3Tv_shJS747U-jajjq2nrtg1zCCPxb33Z6rhvoZcHWF-uUexzEm5ugixS9MpAPFDLJ5QtB5q6WZZUnssR0MXtfITYgOLuiN-iHlNoa57c4_JrgasMh1xBPOZD0',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAhj8KCmDmXB0aXB2v4SzTBYFbm3PQnaWRf9tgSPPfjtzhKHXL3yninfZ2RGRxwoBJKcNqgEa35IOSQzo6uWw-36qc5Nk7T7gcYbKltPVsfhmXGhMeWOtq9qijqec3ckdmAbtqElrrBY2400q0De9l0x17hN61c7zKqHIz0dGitIuLf2gbHRyl22ZKWUTWrIRooVhIl0_aAbAH_sSMMzfOARES1Ainsxqq0czIiYAIgR6TWKq3DqBy-_wRoVbBoXolpR7ZurkJ5qmI',
];

const formatDuration = (durationMs: number): string => {
  const safe = Math.max(0, durationMs);
  const totalMinutes = Math.floor(safe / 60000);
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
        setCameras((previous) => {
          return previous.map((camera) => {
            if (camera.id !== serverOutput.cameraId) {
              return camera;
            }

            return {
              ...camera,
              ...(typeof serverOutput.patch.isOnline === 'boolean' ? { isOnline: serverOutput.patch.isOnline } : {}),
              ...(serverOutput.patch.mode === undefined ? {} : { mode: serverOutput.patch.mode }),
              ...(serverOutput.patch.irMode === undefined ? {} : { irMode: serverOutput.patch.irMode }),
            };
          });
        });
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

  const onlineCount = useMemo(() => {
    return cameras.filter((camera) => camera.isOnline).length;
  }, [cameras]);

  const alertCount = useMemo(() => {
    return cameras.filter((camera) => !camera.isOnline || camera.mode === 'off').length;
  }, [cameras]);

  const uptimeAverage = useMemo(() => {
    if (cameras.length === 0) {
      return '0.0%';
    }

    return `${((onlineCount / cameras.length) * 100).toFixed(1)}%`;
  }, [cameras.length, onlineCount]);

  const cameraViewModels = useMemo<CameraViewModel[]>(() => {
    return cameras.map((camera, index) => {
      const parsedLastSeenAt = camera.lastSeenAt ? Date.parse(camera.lastSeenAt) : Number.NaN;
      const hasLastSeen = Number.isFinite(parsedLastSeenAt);
      const uptimeMs = hasLastSeen ? Date.now() - parsedLastSeenAt : 0;

      const isOffline = !camera.isOnline || camera.mode === 'off';
      // Authoritative source for recording state is the recordingStatus sync —
      // muxer-driven, not derived from Pi Zero telemetry mode flag.
      const isRecording = recordingCameraIds.has(camera.id);

      const recordingKey = isRecording
        ? 'dashboard.recordingActive'
        : isOffline
          ? 'dashboard.recordingDisabled'
          : 'dashboard.recordingPaused';

      const thumbnail = thumbnails.get(camera.id);
      const thumbnailSource = thumbnail ? `data:image/jpeg;base64,${thumbnail.jpegBase64}` : null;

      return {
        camera,
        previewSource: cameraPreviewSources[index % cameraPreviewSources.length],
        thumbnailSource,
        isOffline,
        isRecording,
        statusKey: isOffline ? 'cameras.statusOffline' : 'cameras.statusOnline',
        recordingKey,
        uptime: isOffline || !hasLastSeen ? '--' : formatDuration(uptimeMs),
      };
    });
  }, [cameras, thumbnails, recordingCameraIds]);

  const openCamera = useCallback((cameraId: string, canPreview: boolean) => {
    if (!canPreview) {
      return;
    }

    void router(`/cameras/${cameraId}`);
  }, [router]);

  const hardcodedStorageUsage = '78%';
  const hardcodedUsedSpace = '1.2 TB';

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-6 px-4 py-4 md:px-6 md:py-6 [container-type:inline-size]">
        <div className="[@container(min-width:70rem)]:hidden">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1 px-2 pt-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-common/70">{translate({ key: 'dashboard.operationalIntel' })}</div>
              <div className="text-3xl font-black tracking-tight text-title">{translate({ key: 'dashboard.title' })}</div>
            </div>

            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex min-w-max gap-3 pr-2">
                <div className="w-40 rounded-2xl border border-container2-border bg-container1 p-4 shadow-sm">
                  <div className="mb-2 text-primary">
                    <Icon name="videocam" size="20px" />
                  </div>
                  <div className="text-2xl font-black text-title">{String(cameras.length)}</div>
                  <div className="text-xs font-semibold text-common/80">{translate({ key: 'dashboard.activeFeeds' })}</div>
                </div>

                <div className="w-40 rounded-2xl border border-container2-border bg-container1 p-4 shadow-sm">
                  <div className="mb-2 text-correct">
                    <Icon name="check_circle" size="20px" />
                  </div>
                  <div className="text-2xl font-black text-title">{uptimeAverage}</div>
                  <div className="text-xs font-semibold text-common/80">{translate({ key: 'dashboard.uptimeAverage' })}</div>
                </div>

                <div className="w-40 rounded-2xl border border-container2-border bg-container1 p-4 shadow-sm">
                  <div className="mb-2 text-primary">
                    <Icon name="storage" size="20px" />
                  </div>
                  <div className="text-2xl font-black text-title">{hardcodedUsedSpace}</div>
                  <div className="text-xs font-semibold text-common/80">{translate({ key: 'dashboard.usedSpace' })}</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between px-2">
              <div className="text-lg font-bold text-title">{translate({ key: 'dashboard.availableCameras' })}</div>
              <button className="text-sm font-semibold text-primary" type="button">{translate({ key: 'dashboard.viewMap' })}</button>
            </div>

            {loading && (
              <div className="rounded-2xl border border-container2-border bg-container1 px-4 py-3 text-sm font-medium text-common">
                {translate({ key: 'cameras.loading' })}
              </div>
            )}

            {!loading && cameraViewModels.length === 0 && (
              <div className="rounded-2xl border border-container2-border bg-container1 px-4 py-3 text-sm font-medium text-common">
                {translate({ key: 'cameras.empty' })}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {!loading && cameraViewModels.map((item) => {
                const statusClassName = item.isOffline
                  ? 'border-wrong/25 bg-wrong/10 text-wrong'
                  : 'border-correct/25 bg-correct/10 text-correct';

                const recordingTone = item.isRecording
                  ? 'bg-primary'
                  : item.isOffline
                    ? 'bg-common/40'
                    : 'bg-warning';

                return (
                  <div key={item.camera.id} className={`rounded-2xl border border-container2-border bg-container1 p-4 shadow-sm ${item.isOffline ? 'opacity-85' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-container2-border bg-container2">
                          <img alt="" className={`h-full w-full object-cover ${item.isOffline ? 'grayscale opacity-60' : 'grayscale contrast-125'}`} src={item.thumbnailSource ?? item.previewSource} />
                          {!item.isOffline && (
                            <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/45 px-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-correct animate-pulse" />
                              <span className="text-[8px] font-bold uppercase tracking-wide text-white">{translate({ key: 'dashboard.live' })}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex min-w-0 flex-col">
                          <div className="text-sm font-bold text-title">{item.camera.name}</div>
                          <div className={`mt-1 flex items-center gap-1 text-xs ${item.isOffline ? 'text-wrong' : 'text-common/80'}`}>
                            <Icon name={item.isOffline ? 'warning' : 'schedule'} size="14px" />
                            <span>{item.uptime}</span>
                          </div>
                        </div>
                      </div>

                      <div className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${statusClassName}`}>
                        {translate({ key: item.statusKey })}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-container2-border pt-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${recordingTone}`} />
                        <span className="text-xs font-bold uppercase tracking-wider text-common">{translate({ key: item.recordingKey })}</span>
                      </div>

                      <button
                        className="rounded-lg border border-primary-border bg-primary px-4 py-1.5 text-xs font-bold text-title-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!item.camera.canPreview}
                        onClick={() => {
                          openCamera(item.camera.id, item.camera.canPreview);
                        }}
                        type="button"
                      >
                        {translate({ key: item.camera.canPreview ? 'dashboard.viewFeed' : 'dashboard.troubleshoot' })}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="hidden [@container(min-width:70rem)]:block">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 rounded-3xl border border-container2-border bg-container1 px-8 py-8 shadow-sm">
              <div className="text-4xl font-black tracking-tight text-title">{translate({ key: 'dashboard.overviewTitle' })}</div>
              <div className="text-base font-medium text-common/80">{translate({ key: 'dashboard.overviewSubtitle' })}</div>

              <div className="mt-2 grid grid-cols-4 gap-4">
                <div className="rounded-2xl border border-container2-border bg-container2 px-4 py-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-common/70">{translate({ key: 'dashboard.totalUnits' })}</div>
                  <div className="mt-2 text-3xl font-black text-title">{String(cameras.length)}</div>
                </div>

                <div className="rounded-2xl border border-correct/25 bg-correct/10 px-4 py-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-correct">{translate({ key: 'dashboard.onlineNow' })}</div>
                  <div className="mt-2 text-3xl font-black text-title">{String(onlineCount)}</div>
                </div>

                <div className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-primary">{translate({ key: 'dashboard.storageUsage' })}</div>
                  <div className="mt-2 text-3xl font-black text-title">{hardcodedStorageUsage}</div>
                </div>

                <div className="rounded-2xl border border-wrong/25 bg-wrong/10 px-4 py-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-wrong">{translate({ key: 'dashboard.alerts' })}</div>
                  <div className="mt-2 text-3xl font-black text-title">{String(alertCount)}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-12 px-6 text-xs font-bold uppercase tracking-[0.16em] text-common/60">
              <div className="col-span-5">{translate({ key: 'dashboard.identityAndStream' })}</div>
              <div className="col-span-2">{translate({ key: 'cameras.status' })}</div>
              <div className="col-span-2">{translate({ key: 'dashboard.uptime' })}</div>
              <div className="col-span-2">{translate({ key: 'cameras.recording' })}</div>
              <div className="col-span-1 text-right">{translate({ key: 'dashboard.actions' })}</div>
            </div>

            {loading && (
              <div className="rounded-2xl border border-container2-border bg-container1 px-6 py-4 text-sm font-medium text-common">
                {translate({ key: 'cameras.loading' })}
              </div>
            )}

            {!loading && cameraViewModels.length === 0 && (
              <div className="rounded-2xl border border-container2-border bg-container1 px-6 py-4 text-sm font-medium text-common">
                {translate({ key: 'cameras.empty' })}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {!loading && cameraViewModels.map((item) => {
                const statusClassName = item.isOffline
                  ? 'border-wrong/25 bg-wrong/10 text-wrong'
                  : 'border-correct/25 bg-correct/10 text-correct';

                const recordingTextClass = item.isRecording
                  ? 'text-primary'
                  : item.isOffline
                    ? 'text-common/50'
                    : 'text-warning';

                const recordingDotClass = item.isRecording
                  ? 'bg-primary'
                  : item.isOffline
                    ? 'bg-common/35'
                    : 'bg-warning';

                return (
                  <div key={item.camera.id} className={`grid grid-cols-12 items-center gap-4 rounded-2xl border border-container2-border bg-container1 px-6 py-4 shadow-sm transition-colors ${item.isOffline ? 'border-l-4 border-l-wrong/50' : 'hover:bg-container1-hover'}`}>
                    <div className="col-span-5 flex items-center gap-4">
                      <div className={`relative h-14 w-20 overflow-hidden rounded-lg border border-container2-border bg-container2 ${item.isOffline ? 'opacity-55 grayscale' : ''}`}>
                        <img alt="" className="h-full w-full object-cover" src={item.thumbnailSource ?? item.previewSource} />
                        <div className="absolute left-1 top-1 rounded bg-black/45 px-1 text-[8px] font-bold uppercase tracking-wide text-white">{item.camera.slug}</div>
                      </div>

                      <div className="flex min-w-0 flex-col">
                        <div className="truncate text-base font-bold text-title">{item.camera.name}</div>
                        <div className="truncate text-xs font-medium text-common/80">{item.camera.slug}</div>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusClassName}`}>
                        {!item.isOffline && <span className="h-2 w-2 rounded-full bg-correct animate-pulse" />}
                        <span>{translate({ key: item.statusKey })}</span>
                      </div>
                    </div>

                    <div className={`col-span-2 flex items-center gap-2 text-sm font-semibold ${item.isOffline ? 'text-wrong' : 'text-title'}`}>
                      <Icon name={item.isOffline ? 'warning' : 'schedule'} size="16px" />
                      <span>{item.uptime}</span>
                    </div>

                    <div className="col-span-2 flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${recordingDotClass}`} />
                      <span className={`text-xs font-bold uppercase tracking-wide ${recordingTextClass}`}>{translate({ key: item.recordingKey })}</span>
                    </div>

                    <div className="col-span-1 flex justify-end">
                      <button
                        className="rounded-lg border border-container2-border bg-container2 p-2 text-common transition-colors hover:bg-container2-hover disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!item.camera.canPreview}
                        onClick={() => {
                          openCamera(item.camera.id, item.camera.canPreview);
                        }}
                        type="button"
                      >
                        <Icon name={item.isOffline ? 'refresh' : 'more_vert'} size="18px" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
