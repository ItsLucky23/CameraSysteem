import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { backendUrl, sessionBasedToken } from 'config';
import tryCatch from 'shared/tryCatch';

import { confirmDialog } from 'src/_components/ConfirmMenu';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';

import Chip from 'src/_components/ui/Chip';
import MaterialIcon from 'src/_components/ui/MaterialIcon';
import PageTopBar from 'src/_components/ui/PageTopBar';
import StatusDot from 'src/_components/ui/StatusDot';

export const template = 'aperture';

// In dev (sessionBasedToken=true) the auth token lives in sessionStorage and
// the <video> / <img> elements cannot send Authorization headers, so we tack
// it onto the URL as ?token=. In cookie mode the cookie travels with the
// request and no query param is needed.
const appendTokenIfNeeded = (base: string): string => {
  if (!sessionBasedToken) return base;
  const token = sessionStorage.getItem('token');
  if (!token) return base;
  return `${base}?token=${encodeURIComponent(token)}`;
};

const buildRecordingUrl = (recordingId: string): string =>
  appendTokenIfNeeded(`${backendUrl}/recordings/stream/${recordingId}`);

const buildRecordingThumbnailUrl = (recordingId: string): string =>
  appendTokenIfNeeded(`${backendUrl}/recordings/thumbnail/${recordingId}.jpg`);

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

interface FlatClip {
  cameraId: string;
  cameraName: string;
  entry: HistoryEntry;
  isActive: boolean;
  active?: ActiveRecordingInfo | null;
}

type ClipKind = 'all' | 'manual' | 'motion' | 'schedule';

const padTwo = (value: number): string => String(value).padStart(2, '0');

const formatDurationMs = (durationMs: number | null): string => {
  if (durationMs === null || durationMs <= 0) return '00:00:00';
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

const formatTimeOfDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
};

const formatActiveElapsed = (startedAtIso: string, now: number): string => {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return '00:00:00';
  return formatDurationMs(Math.max(0, now - startMs));
};

const sumBytes = (clips: FlatClip[]): number => clips.reduce((acc, clip) => acc + (clip.entry.fileSizeBytes ?? 0), 0);

const sortableTime = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

const dayKey = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getFullYear())}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
};

const todayKey = (): string => dayKey(new Date().toISOString());

const dayLabel = (key: string): { weekday: string; date: string } => {
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const weekdayLabel = d.toLocaleDateString(undefined, { weekday: 'short' });
  return { weekday: weekdayLabel.slice(0, 3).toUpperCase(), date: padTwo(d.getDate()) };
};

const classifyClip = (entry: HistoryEntry, isActive: boolean): ClipKind => {
  if (isActive) return 'manual';
  const reason = entry.stopReason?.toLowerCase() ?? '';
  if (reason.includes('motion')) return 'motion';
  if (reason.includes('schedule')) return 'schedule';
  return 'manual';
};

const previousNDays = (n: number): string[] => {
  const days: string[] = [];
  const today = new Date();
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    days.push(`${String(d.getFullYear())}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`);
  }
  return days;
};

type ViewMode = 'day' | 'all';

const yesterdayKey = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${String(d.getFullYear())}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
};

export default function RecordingsPage() {
  const translate = useTranslator();
  const { upsertSyncEventCallback } = useSyncEvents();

  const [loading, setLoading] = useState<boolean>(true);
  const [sections, setSections] = useState<PerCameraSection[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const [activeDay, setActiveDay] = useState<string>(todayKey());
  const [kindFilter, setKindFilter] = useState<ClipKind>('all');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const lastSeededDayRef = useRef<string | null>(null);

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
        setSections((previous) => previous.map((section) => {
          if (section.cameraId !== serverOutput.cameraId) return section;
          const previousActiveId = section.activeRecording?.id ?? null;
          const newActive: ActiveRecordingInfo | null = serverOutput.recordingId && serverOutput.startedAt
            ? {
              id: serverOutput.recordingId,
              startedAt: serverOutput.startedAt,
              startedByUserId: serverOutput.startedByUserId ?? '',
            }
            : null;
          if (previousActiveId && !newActive) {
            void loadList();
          }
          return { ...section, activeRecording: newActive };
        }));
      },
    });

    return () => {
      unsubscribeStatus();
    };
  }, [upsertSyncEventCallback, loadList]);

  useEffect(() => {
    const hasActive = sections.some((section) => section.activeRecording !== null);
    if (!hasActive) return;
    const interval = globalThis.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { globalThis.clearInterval(interval); };
  }, [sections]);

  const handleStop = useCallback(async (recordingId: string) => {
    const confirmed = await confirmDialog({
      title: translate({ key: 'recordings.stopRecording' }),
      content: translate({ key: 'recordings.confirmStop' }),
    });
    if (!confirmed) return;

    const [callError, response] = await tryCatch(async () => apiRequest({
      name: 'cameras/recording/stop',
      version: 'v1',
      data: { recordingId },
    }));

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

  const allClips = useMemo<FlatClip[]>(() => {
    const out: FlatClip[] = [];
    for (const section of sections) {
      if (section.activeRecording) {
        out.push({
          cameraId: section.cameraId,
          cameraName: section.cameraName,
          isActive: true,
          active: section.activeRecording,
          entry: {
            id: section.activeRecording.id,
            startedAt: section.activeRecording.startedAt,
            stoppedAt: null,
            durationMs: Math.max(0, now - Date.parse(section.activeRecording.startedAt)),
            fileSizeBytes: null,
            startedByUserId: section.activeRecording.startedByUserId,
            stopReason: null,
          },
        });
      }
      for (const entry of section.history) {
        out.push({
          cameraId: section.cameraId,
          cameraName: section.cameraName,
          isActive: false,
          entry,
        });
      }
    }
    return out;
  }, [sections, now]);

  const dayClipCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const clip of allClips) {
      const k = dayKey(clip.entry.startedAt);
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [allClips]);

  const sevenDays = useMemo(() => previousNDays(7), []);

  const dayClips = useMemo(() => {
    return allClips
      .filter((clip) => dayKey(clip.entry.startedAt) === activeDay)
      .toSorted((a, b) => sortableTime(b.entry.startedAt) - sortableTime(a.entry.startedAt));
  }, [allClips, activeDay]);

  const filteredClips = useMemo(() => {
    if (kindFilter === 'all') return dayClips;
    return dayClips.filter((clip) => classifyClip(clip.entry, clip.isActive) === kindFilter);
  }, [dayClips, kindFilter]);

  // All-time clips (any day), filtered by kind, sorted newest-first, then
  // grouped by day so the All view can render date headers.
  const allFilteredClips = useMemo(() => {
    const sorted = allClips.toSorted((a, b) => sortableTime(b.entry.startedAt) - sortableTime(a.entry.startedAt));
    if (kindFilter === 'all') return sorted;
    return sorted.filter((clip) => classifyClip(clip.entry, clip.isActive) === kindFilter);
  }, [allClips, kindFilter]);

  const allGroupedByDay = useMemo<{ key: string; clips: FlatClip[] }[]>(() => {
    const groups = new Map<string, FlatClip[]>();
    for (const clip of allFilteredClips) {
      const k = dayKey(clip.entry.startedAt);
      const list = groups.get(k) ?? [];
      list.push(clip);
      groups.set(k, list);
    }
    return [...groups.entries()].map(([key, clips]) => ({ key, clips }));
  }, [allFilteredClips]);

  const allTotals = useMemo(() => ({
    count: allFilteredClips.length,
    bytes: sumBytes(allFilteredClips),
  }), [allFilteredClips]);

  const dailyTotals = useMemo(() => ({
    count: dayClips.length,
    bytes: sumBytes(dayClips),
  }), [dayClips]);

  // Top 4 cameras by clip-count for that day, fall back to first cameras
  const laneCameras = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clip of dayClips) {
      counts.set(clip.cameraId, (counts.get(clip.cameraId) ?? 0) + 1);
    }
    const sortedSections = sections.toSorted((a, b) => (counts.get(b.cameraId) ?? 0) - (counts.get(a.cameraId) ?? 0));
    return sortedSections.slice(0, 4);
  }, [dayClips, sections]);

  const lanesData = useMemo(() => {
    const dayStart = new Date(activeDay + 'T00:00:00').getTime();
    return laneCameras.map((section) => {
      const clipsForCamera = dayClips.filter((clip) => clip.cameraId === section.cameraId);
      const segments = clipsForCamera.map((clip) => {
        const startMs = Date.parse(clip.entry.startedAt);
        const startSec = Math.max(0, (startMs - dayStart) / 1000);
        const startPct = (startSec / 86_400) * 100;
        const durMs = clip.entry.durationMs ?? 60_000;
        const durSec = Math.max(60, durMs / 1000);
        const widthPct = Math.min(100 - startPct, (durSec / 86_400) * 100);
        const kind = classifyClip(clip.entry, clip.isActive);
        let tone: string;
        if (clip.isActive) {
          tone = 'var(--color-wrong)';
        } else if (kind === 'motion') {
          tone = 'var(--color-correct)';
        } else if (kind === 'schedule') {
          tone = 'var(--color-warning)';
        } else {
          tone = 'var(--color-primary)';
        }
        return {
          id: clip.entry.id,
          leftPct: startPct,
          widthPct: Math.max(0.5, widthPct),
          tone,
        };
      });
      return { cameraId: section.cameraId, cameraName: section.cameraName, segments };
    });
  }, [laneCameras, dayClips, activeDay]);

  const playheadPct = useMemo(() => {
    const isToday = activeDay === todayKey();
    if (!isToday) return null;
    const dayStart = new Date(activeDay + 'T00:00:00').getTime();
    // `now` triggers a re-tick so the playhead advances live.
    const elapsedSec = Math.max(0, (now - dayStart) / 1000);
    return Math.max(0, Math.min(100, (elapsedSec / 86_400) * 100));
  }, [activeDay, now]);

  const playheadLabel = useMemo(() => {
    if (playheadPct === null) return null;
    const d = new Date();
    return `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
  }, [playheadPct]);

  // Auto-select the first clip on day or view-mode change. The seed key
  // includes the view so switching to All re-seeds even if activeDay didn't
  // change.
  useEffect(() => {
    const seedKey = viewMode === 'day' ? `day:${activeDay}` : 'all';
    if (lastSeededDayRef.current === seedKey) return;
    lastSeededDayRef.current = seedKey;
    const list = viewMode === 'day' ? filteredClips : allFilteredClips;
    setSelectedClipId(list.length > 0 ? list[0].entry.id : null);
  }, [activeDay, viewMode, filteredClips, allFilteredClips]);

  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return allClips.find((clip) => clip.entry.id === selectedClipId) ?? null;
  }, [allClips, selectedClipId]);

  const dateHeading = useMemo(() => {
    const [year, month, day] = activeDay.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }, [activeDay]);

  const groupDayHeader = useCallback((key: string): string => {
    if (key === todayKey()) return translate({ key: 'aperture.recordings.groupToday' });
    if (key === yesterdayKey()) return translate({ key: 'aperture.recordings.groupYesterday' });
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [translate]);

  const filterTabs: { value: ClipKind; key: string }[] = [
    { value: 'all', key: 'aperture.recordings.filterAll' },
    { value: 'manual', key: 'aperture.recordings.filterManual' },
    { value: 'motion', key: 'aperture.recordings.filterMotion' },
    { value: 'schedule', key: 'aperture.recordings.filterSchedule' },
  ];

  // Storage stats placeholders — we don't have a dedicated storage API yet.
  const storageUsedTb = '23.4';
  const storageTotalTb = '100';
  const storagePercent = 23;
  const storageRemainingTb = '76.6';

  return (
    <main className="thin-scroll flex h-full w-full flex-col overflow-y-auto bg-background">
      <PageTopBar
        eyebrow={translate({ key: 'aperture.recordings.eyebrow' })}
        title={translate({ key: 'aperture.recordings.title' })}
        subtitle={translate({ key: 'aperture.recordings.subtitle' })}
        actions={
          <>
            <div className="flex gap-1 rounded-[10px] bg-container2 p-0.5">
              {([
                { value: 'day' as ViewMode, key: 'aperture.recordings.viewModeDay', icon: 'today' },
                { value: 'all' as ViewMode, key: 'aperture.recordings.viewModeAll', icon: 'list' },
              ]).map((tab) => {
                const active = viewMode === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => { setViewMode(tab.value); }}
                    className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition-colors ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                  >
                    <MaterialIcon name={tab.icon} size={14} />
                    {translate({ key: tab.key })}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => { void loadList(); }}
              className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
            >
              <MaterialIcon name="refresh" size={16} />
              {translate({ key: 'aperture.recordings.refresh' })}
            </button>
          </>
        }
      />

      <section className={`grid grid-cols-1 gap-4 px-9 pb-4 ${viewMode === 'day' ? 'lg:grid-cols-[1.4fr_1fr]' : ''}`}>
        <div className="flex items-center gap-6 rounded-2xl border border-container1-border bg-container1 p-5">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              {translate({ key: 'aperture.recordings.storage' })}
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-display text-[32px] text-title">{storageUsedTb} TB</span>
              <span className="text-[13px] text-muted">
                {translate({ key: 'aperture.recordings.storageOf' }).replace('{{capacity}}', `${storageTotalTb} TB`)}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-container2">
              <div className="h-full rounded-full bg-primary" style={{ width: `${String(storagePercent)}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
              <span>
                {viewMode === 'day'
                  ? `${translate({ key: 'aperture.recordings.summarySize' }).replace('{{size}}', formatFileSize(dailyTotals.bytes))} ${translate({ key: 'aperture.recordings.todayWritten' })}`
                  : translate({ key: 'aperture.recordings.allRecordingsSummary' })
                    .replace('{{count}}', String(allTotals.count))
                    .replace('{{size}}', formatFileSize(allTotals.bytes))}
              </span>
              <span>
                {translate({ key: 'aperture.recordings.storageRemaining' }).replace('{{remaining}}', `${storageRemainingTb} TB`)}
              </span>
            </div>
          </div>
        </div>

        {viewMode === 'day' && (
          <div className="flex items-stretch gap-1.5 overflow-x-auto rounded-2xl border border-container1-border bg-container1 p-3">
            {sevenDays.map((key) => {
              const active = key === activeDay;
              const label = dayLabel(key);
              const count = dayClipCounts.get(key) ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setActiveDay(key); }}
                  className={`flex min-w-[56px] flex-1 flex-col items-center gap-0.5 rounded-[10px] px-1.5 py-2 transition-colors ${active ? 'bg-primary text-title-primary' : 'border border-container1-border bg-transparent text-title hover:bg-container2/60'}`}
                >
                  <span className={`font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] ${active ? 'opacity-85' : 'opacity-55'}`}>{label.weekday}</span>
                  <span className="font-display text-[18px] leading-none">{label.date}</span>
                  <span className={`font-mono text-[9.5px] ${active ? 'opacity-85' : 'opacity-55'}`}>
                    {translate({ key: 'aperture.recordings.dayClipCount' }).replace('{{count}}', String(count))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {viewMode === 'day' && (
      <section className="px-9 pb-4">
        <div className="rounded-2xl border border-container1-border bg-container1 p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              {dateHeading} · {translate({ key: 'aperture.recordings.timelineLabel' })}
            </div>
            <div className="font-mono text-[12px] text-muted">
              {playheadLabel
                ? translate({ key: 'aperture.recordings.playheadLabel' })
                  .replace('{{time}}', playheadLabel)
                  .replace('{{size}}', formatFileSize(dailyTotals.bytes))
                : formatFileSize(dailyTotals.bytes)}
            </div>
          </div>

          <div className="mb-1.5 grid" style={{ gridTemplateColumns: '140px 1fr' }}>
            <div />
            <div className="flex justify-between font-mono text-[10px] text-muted">
              {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'].map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
          </div>

          <div className="relative">
            {lanesData.length === 0 && (
              <div className="py-3 text-center text-xs text-muted">{translate({ key: 'aperture.recordings.noLanes' })}</div>
            )}
            {lanesData.map((lane) => (
              <div key={lane.cameraId} className="mt-1.5 grid items-center gap-3" style={{ gridTemplateColumns: '140px 1fr' }}>
                <div className="truncate text-[12px] font-semibold text-common">{lane.cameraName}</div>
                <div className="relative h-[18px] overflow-hidden rounded-[4px] bg-container2">
                  {lane.segments.map((segment) => (
                    <div
                      key={segment.id}
                      className="absolute top-[3px] bottom-[3px] rounded-[2px]"
                      style={{
                        left: `${String(segment.leftPct)}%`,
                        width: `${String(segment.widthPct)}%`,
                        background: segment.tone,
                        opacity: 0.85,
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}

            {playheadPct !== null && lanesData.length > 0 && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-title"
                style={{ left: `calc(140px + 12px + ${String(playheadPct)}%)` }}
              />
            )}
          </div>
        </div>
      </section>
      )}

      <section className="grid min-h-[26rem] flex-1 grid-cols-1 gap-4 px-9 pb-9 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-container1-border bg-container1">
          <div className="flex items-center justify-between gap-3 border-b border-container1-border px-5 py-3.5">
            <h2 className="font-display m-0 text-[20px] text-title">
              {viewMode === 'day'
                ? translate({ key: 'aperture.recordings.summaryClips' }).replace('{{count}}', String(filteredClips.length))
                : `${translate({ key: 'aperture.recordings.allRecordingsHeader' })} · ${translate({ key: 'aperture.recordings.summaryClips' }).replace('{{count}}', String(allTotals.count))}`}
            </h2>
            <div className="flex gap-1 rounded-lg bg-container2 p-0.5">
              {filterTabs.map((tab) => {
                const active = kindFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => { setKindFilter(tab.value); }}
                    className={`rounded-[6px] border px-3 py-1 text-[11.5px] font-semibold transition-colors ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                  >
                    {translate({ key: tab.key })}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid items-center border-b border-container1-border px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted" style={{ gridTemplateColumns: '1.4fr 0.7fr 0.8fr 0.7fr 0.9fr 60px' }}>
            <div>{translate({ key: 'aperture.recordings.colCameraStarted' })}</div>
            <div>{translate({ key: 'aperture.recordings.colDuration' })}</div>
            <div>{translate({ key: 'aperture.recordings.colSize' })}</div>
            <div>{translate({ key: 'aperture.recordings.colBy' })}</div>
            <div>{translate({ key: 'aperture.recordings.colReason' })}</div>
            <div></div>
          </div>

          <div className="thin-scroll flex-1 overflow-y-auto">
            {loading && (
              <div className="px-5 py-4 text-sm text-muted">{translate({ key: 'aperture.recordings.loading' })}</div>
            )}
            {!loading && viewMode === 'day' && filteredClips.length === 0 && (
              <div className="px-5 py-4 text-sm text-muted">{translate({ key: 'aperture.recordings.noResults' })}</div>
            )}
            {!loading && viewMode === 'all' && allFilteredClips.length === 0 && (
              <div className="px-5 py-4 text-sm text-muted">{translate({ key: 'aperture.recordings.noResults' })}</div>
            )}

            {!loading && viewMode === 'day' && filteredClips.map((clip, index) => (
              <ClipRow
                key={clip.entry.id}
                clip={clip}
                isSelected={selectedClipId === clip.entry.id}
                isLast={index === filteredClips.length - 1}
                now={now}
                translate={translate}
                onSelect={setSelectedClipId}
              />
            ))}

            {!loading && viewMode === 'all' && allGroupedByDay.map((group) => (
              <div key={group.key}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-container1-border bg-container1/95 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted backdrop-blur">
                  <span>{groupDayHeader(group.key)}</span>
                  <span className="font-mono text-[10.5px] text-muted">
                    {translate({ key: 'aperture.recordings.dayClipCount' }).replace('{{count}}', String(group.clips.length))}
                  </span>
                </div>
                {group.clips.map((clip, index) => (
                  <ClipRow
                    key={clip.entry.id}
                    clip={clip}
                    isSelected={selectedClipId === clip.entry.id}
                    isLast={index === group.clips.length - 1}
                    now={now}
                    translate={translate}
                    onSelect={setSelectedClipId}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-container1-border bg-container1">
          <div className="border-b border-container1-border px-5 py-3.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              {translate({ key: 'aperture.recordings.selectedClip' })}
            </div>
            {selectedClip ? (
              <>
                <div className="mt-1 text-[16px] font-semibold text-title">{selectedClip.cameraName}</div>
                <div className="font-mono text-[11.5px] text-muted">
                  {selectedClip.cameraId.slice(-6)} · {translate({ key: 'aperture.recordings.startedAt' })} {formatTimeOfDay(selectedClip.entry.startedAt)}
                  {selectedClip.isActive ? ` · ${translate({ key: 'aperture.recordings.inProgress' })}` : ''}
                </div>
              </>
            ) : (
              <div className="mt-1 text-[14px] text-muted">{translate({ key: 'aperture.recordings.noSelection' })}</div>
            )}
          </div>

          {selectedClip ? (
            <>
              <div className="relative m-4 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '16/9' }}>
                {selectedClip.isActive ? (
                  <div className="cam-placeholder h-full w-full opacity-40" />
                ) : (
                  <video
                    controls
                    preload="metadata"
                    className="h-full w-full object-contain"
                    src={buildRecordingUrl(selectedClip.entry.id)}
                    poster={buildRecordingThumbnailUrl(selectedClip.entry.id)}
                  >
                    <track kind="captions" />
                  </video>
                )}
                {selectedClip.isActive && (
                  <div className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-md bg-wrong/85 px-2 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    <span className="font-mono text-[10px] font-bold text-white">
                      REC {formatActiveElapsed(selectedClip.entry.startedAt, now)}
                    </span>
                  </div>
                )}
              </div>

              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {[
                    {
                      key: translate({ key: 'aperture.recordings.duration' }),
                      value: selectedClip.isActive
                        ? formatActiveElapsed(selectedClip.entry.startedAt, now)
                        : formatDurationMs(selectedClip.entry.durationMs),
                      mono: true,
                    },
                    {
                      key: translate({ key: 'aperture.recordings.size' }),
                      value: formatFileSize(selectedClip.entry.fileSizeBytes),
                      mono: true,
                    },
                    {
                      key: translate({ key: 'aperture.recordings.startedBy' }),
                      value: selectedClip.entry.startedByUserId.slice(0, 8) || '—',
                      mono: false,
                    },
                    {
                      key: translate({ key: 'aperture.recordings.stopReason' }),
                      value: selectedClip.isActive ? translate({ key: 'aperture.recordings.inProgress' }) : (selectedClip.entry.stopReason ?? '—'),
                      mono: false,
                    },
                  ].map((row) => (
                    <div key={row.key} className="flex justify-between rounded-lg bg-container2 px-3 py-2">
                      <span className="text-muted">{row.key}</span>
                      <span className={`font-semibold text-title ${row.mono ? 'font-mono' : ''}`}>{row.value}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-2">
                  {selectedClip.isActive ? (
                    <button
                      type="button"
                      onClick={() => { if (selectedClip.active) void handleStop(selectedClip.active.id); }}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-semibold text-wrong transition-colors hover:bg-wrong-soft"
                    >
                      <MaterialIcon name="stop_circle" size={16} />
                      {translate({ key: 'aperture.recordings.stop' })}
                    </button>
                  ) : (
                    <a
                      href={buildRecordingUrl(selectedClip.entry.id)}
                      download
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover"
                    >
                      <MaterialIcon name="download" size={16} />
                      {translate({ key: 'aperture.recordings.download' })}
                    </a>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-6 pt-2 text-center">
              <MaterialIcon name="movie" size={32} className="text-muted" />
              <div className="text-sm text-muted">{translate({ key: 'aperture.recordings.noResultsSub' })}</div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

interface ClipRowProps {
  clip: FlatClip;
  isSelected: boolean;
  isLast: boolean;
  now: number;
  translate: ReturnType<typeof useTranslator>;
  onSelect: (id: string) => void;
}

function ClipRow({ clip, isSelected, isLast, now, translate, onSelect }: ClipRowProps) {
  const rowStyle = isSelected
    ? { background: 'var(--color-primary-soft)' }
    : (clip.isActive ? { background: 'var(--color-wrong-soft)' } : undefined);
  return (
    <button
      type="button"
      onClick={() => { onSelect(clip.entry.id); }}
      className={`grid w-full items-center gap-2 px-5 py-3 text-left transition-colors ${isLast ? '' : 'border-b border-container1-border'} ${isSelected ? '' : 'hover:bg-container2/40'}`}
      style={{ gridTemplateColumns: '1.4fr 0.7fr 0.8fr 0.7fr 0.9fr 60px', ...rowStyle }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative h-[30px] w-[48px] shrink-0 overflow-hidden rounded-[5px] bg-container2">
          {clip.isActive ? (
            <div className="cam-placeholder h-full w-full" />
          ) : (
            <img
              src={buildRecordingThumbnailUrl(clip.entry.id)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          )}
          {clip.isActive && (
            <span
              className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-wrong"
              style={{ boxShadow: '0 0 0 3px rgba(194,52,43,0.25)' }}
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-title">{clip.cameraName}</div>
          <div className="font-mono text-[11px] text-muted">
            {formatTimeOfDay(clip.entry.startedAt)} · {clip.cameraId.slice(-6)}
          </div>
        </div>
      </div>
      <div className="font-mono text-[12.5px] text-title">
        {clip.isActive ? formatActiveElapsed(clip.entry.startedAt, now) : formatDurationMs(clip.entry.durationMs)}
      </div>
      <div className="font-mono text-[12.5px] text-common">{formatFileSize(clip.entry.fileSizeBytes)}</div>
      <div className="truncate text-[12px] text-common">
        {clip.entry.startedByUserId ? clip.entry.startedByUserId.slice(0, 8) : '—'}
      </div>
      <div className="text-[12px] text-muted">
        {clip.isActive
          ? (
            <Chip variant="wrong">
              <StatusDot status="rec" pulse />
              {translate({ key: 'aperture.recordings.active' })}
            </Chip>
          )
          : (clip.entry.stopReason ?? '—')}
      </div>
      <div className="flex justify-end">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md text-common">
          <MaterialIcon name="play_arrow" size={16} />
        </span>
      </div>
    </button>
  );
}
