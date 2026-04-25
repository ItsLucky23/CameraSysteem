import { useCallback, useEffect, useMemo, useState } from 'react';

import tryCatch from 'shared/tryCatch';

import Icon from 'src/_components/Icon';
import { confirmDialog } from 'src/_components/ConfirmMenu';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'home';

interface ActiveRecordingInfo {
  id: string;
  startedAt: string;
  startedByUserId: string;
}

interface HistoryEntry {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number | null;
  fileSizeBytes: number | null;
  startedByUserId: string;
  stopReason: string | null;
}

interface PerCameraSection {
  cameraId: string;
  cameraName: string;
  activeRecording: ActiveRecordingInfo | null;
  history: HistoryEntry[];
}

const padTwo = (value: number): string => String(value).padStart(2, '0');

const formatDurationMs = (durationMs: number | null): string => {
  if (durationMs === null || durationMs <= 0) return '--';
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${padTwo(hours)}:${padTwo(minutes)}:${padTwo(seconds)}`;
};

const formatFileSize = (bytes: number | null): string => {
  if (bytes === null || bytes <= 0) return '--';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const formatStartedAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yyyy = date.getFullYear();
  const mm = padTwo(date.getMonth() + 1);
  const dd = padTwo(date.getDate());
  const hh = padTwo(date.getHours());
  const min = padTwo(date.getMinutes());
  return `${String(yyyy)}-${mm}-${dd} ${hh}:${min}`;
};

const formatActiveElapsed = (startedAtIso: string, now: number): string => {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return '00:00:00';
  return formatDurationMs(Math.max(0, now - startMs));
};

export default function RecordingsPage() {
  const translate = useTranslator();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loading, setLoading] = useState<boolean>(true);
  const [sections, setSections] = useState<PerCameraSection[]>([]);
  const [busyCameraId, setBusyCameraId] = useState<string | null>(null);
  const [openVideoRecordingId, setOpenVideoRecordingId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const loadList = useCallback(async () => {
    setLoading(true);
    const response = await apiRequest({
      name: 'cameras/recording/getList',
      version: 'v1',
      data: {},
    });

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
      setLoading(false);
      return;
    }

    setSections(response.perCamera);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void joinRoom('cameras-overview');
    return () => {
      void leaveRoom('cameras-overview');
    };
  }, []);

  useEffect(() => {
    const unsubscribeStatus = upsertSyncEventCallback({
      name: 'cameras/recordingStatus',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setSections((previous) => {
          return previous.map((section) => {
            if (section.cameraId !== serverOutput.cameraId) {
              return section;
            }
            const previousActiveId = section.activeRecording?.id ?? null;
            const newActive: ActiveRecordingInfo | null = serverOutput.recordingId && serverOutput.startedAt
              ? {
                id: serverOutput.recordingId,
                startedAt: serverOutput.startedAt,
                startedByUserId: serverOutput.startedByUserId ?? '',
              }
              : null;

            // When a recording stops, it may not yet appear in `history` if the
            // sync arrives before the API list refresh. Refresh the list in
            // the background so the new entry shows up with size/duration.
            if (previousActiveId && !newActive) {
              void loadList();
            }

            return { ...section, activeRecording: newActive };
          });
        });
      },
    });

    const unsubscribeState = upsertSyncEventCallback({
      name: 'cameras/cameraStateUpdated',
      version: 'v1',
      callback: () => {
        // Camera state updates do not change the recordings list directly,
        // but if a camera came online while a stop was pending we want fresh
        // data. Cheap enough to just be a no-op here.
      },
    });

    return () => {
      unsubscribeStatus();
      unsubscribeState();
    };
  }, [upsertSyncEventCallback, loadList]);

  // Keep the active-recording elapsed counter ticking once per second.
  useEffect(() => {
    const hasActive = sections.some((section) => section.activeRecording !== null);
    if (!hasActive) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [sections]);

  const handleStart = useCallback(async (cameraId: string) => {
    const confirmed = await confirmDialog({
      title: translate({ key: 'recordings.startRecording' }),
      content: translate({ key: 'recordings.confirmStart' }),
    });
    if (!confirmed) return;

    setBusyCameraId(cameraId);
    const [callError, response] = await tryCatch(async () => apiRequest({
      name: 'cameras/recording/start',
      version: 'v1',
      data: { cameraId },
    }));
    setBusyCameraId(null);

    if (callError || !response) {
      notify.error({ key: 'recordings.errorStartFailed' });
      return;
    }

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
      return;
    }

    notify.success({ key: 'recordings.activeRecording' });
    await loadList();
  }, [translate, loadList]);

  const handleStop = useCallback(async (recordingId: string) => {
    const confirmed = await confirmDialog({
      title: translate({ key: 'recordings.stopRecording' }),
      content: translate({ key: 'recordings.confirmStop' }),
    });
    if (!confirmed) return;

    setBusyCameraId(recordingId);
    const [callError, response] = await tryCatch(async () => apiRequest({
      name: 'cameras/recording/stop',
      version: 'v1',
      data: { recordingId },
    }));
    setBusyCameraId(null);

    if (callError || !response) {
      notify.error({ key: 'recordings.errorStopFailed' });
      return;
    }

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
      return;
    }

    await loadList();
  }, [translate, loadList]);

  const togglePlay = useCallback((recordingId: string) => {
    setOpenVideoRecordingId((current) => (current === recordingId ? null : recordingId));
  }, []);

  const renderedSections = useMemo(() => sections, [sections]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold text-title">{translate({ key: 'recordings.title' })}</h1>
        <div className="text-muted">{translate({ key: 'recordings.loading' })}</div>
      </div>
    );
  }

  if (renderedSections.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold text-title">{translate({ key: 'recordings.title' })}</h1>
        <div className="text-muted">{translate({ key: 'recordings.empty' })}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-title">{translate({ key: 'recordings.title' })}</h1>
        <p className="text-muted text-sm">{translate({ key: 'recordings.subtitle' })}</p>
      </div>

      <div className="flex flex-col gap-6">
        {renderedSections.map((section) => {
          const active = section.activeRecording;
          const sectionBusy = busyCameraId === section.cameraId || (active && busyCameraId === active.id);

          return (
            <div
              key={section.cameraId}
              className="flex flex-col gap-3 rounded border border-container2-border bg-container2 p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Icon name="videocam" size="22px" />
                  <span className="text-lg font-semibold text-title">{section.cameraName}</span>
                </div>

                {active ? (
                  <div className="flex items-center gap-2 rounded bg-wrong/20 px-2 py-1 text-wrong text-sm">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-wrong"></span>
                    <span>{translate({ key: 'recordings.activeRecording' })}</span>
                    <span className="font-mono">{formatActiveElapsed(active.startedAt, now)}</span>
                  </div>
                ) : null}

                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleStart(section.cameraId); }}
                    disabled={Boolean(active) || Boolean(sectionBusy)}
                    className="flex items-center gap-2 rounded bg-correct px-3 py-1.5 text-sm text-white transition hover:bg-correct-hover disabled:opacity-60"
                  >
                    <Icon name="fiber_manual_record" size="16px" />
                    <span>{translate({ key: 'recordings.startRecording' })}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (active) { void handleStop(active.id); } }}
                    disabled={!active || Boolean(sectionBusy)}
                    className="flex items-center gap-2 rounded bg-wrong px-3 py-1.5 text-sm text-white transition hover:bg-wrong-hover disabled:opacity-60"
                  >
                    <Icon name="stop" size="16px" />
                    <span>{translate({ key: 'recordings.stopRecording' })}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {section.history.length === 0 ? (
                  <div className="text-muted text-sm">{translate({ key: 'recordings.noRecordings' })}</div>
                ) : (
                  section.history.map((entry) => {
                    const isOpen = openVideoRecordingId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="flex flex-col gap-2 rounded border border-container3-border bg-container3 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <div className="flex flex-col">
                            <span className="text-muted text-xs">{translate({ key: 'recordings.startedAt' })}</span>
                            <span className="font-mono text-common">{formatStartedAt(entry.startedAt)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-muted text-xs">{translate({ key: 'recordings.duration' })}</span>
                            <span className="font-mono text-common">{formatDurationMs(entry.durationMs)}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-muted text-xs">{translate({ key: 'recordings.size' })}</span>
                            <span className="font-mono text-common">{formatFileSize(entry.fileSizeBytes)}</span>
                          </div>
                          {entry.stopReason ? (
                            <div className="flex flex-col">
                              <span className="text-muted text-xs">{translate({ key: 'recordings.stopReason' })}</span>
                              <span className="font-mono text-common">{entry.stopReason}</span>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => { togglePlay(entry.id); }}
                            disabled={entry.stoppedAt === null}
                            className="ml-auto flex items-center gap-2 rounded bg-container4 px-3 py-1.5 text-common text-sm transition hover:bg-container4-hover disabled:opacity-60"
                          >
                            <Icon name={isOpen ? 'close' : 'play_arrow'} size="16px" />
                            <span>
                              {isOpen
                                ? translate({ key: 'recordings.close' })
                                : translate({ key: 'recordings.play' })}
                            </span>
                          </button>
                        </div>

                        {isOpen ? (
                          <video
                            controls
                            preload="metadata"
                            className="w-full max-w-3xl rounded bg-background"
                            src={`/recordings/stream/${entry.id}`}
                          ></video>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
