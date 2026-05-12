import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import tryCatch from 'shared/tryCatch';

import { confirmDialog } from 'src/_components/ConfirmMenu';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';

import Chip from 'src/_components/ui/Chip';
import MaterialIcon from 'src/_components/ui/MaterialIcon';
import StatusDot from 'src/_components/ui/StatusDot';
import Toggle from 'src/_components/ui/Toggle';

export const template = 'aperture';

interface PageProps {
  params?: Record<string, string | undefined>;
  searchParams?: Record<string, string | undefined>;
}

type CameraQuality = 'low' | 'medium' | 'high';

interface Capabilities {
  hasCamera: boolean;
  hasIR: boolean;
  hasPanTilt: boolean;
  hasMicrophone: boolean;
  hasSpeaker: boolean;
  // MOTION DETECTION LOGIC (paused) — capability omitted server-side so the
  // type is optional here to keep API response shapes assignable.
  hasMotion?: boolean;
  hasZoom: boolean;
  hasTemperature: boolean;
}

interface CameraListItem {
  id: string;
  slug: string;
  name: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  irMode: 'off' | 'on' | 'auto';
  irStrength: number;
  targetFps: number;
  quality: CameraQuality;
  canPreview: boolean;
  canControl: boolean;
  lastSeenAt: string | null;
  capabilities: Capabilities | null;
  activeRecording: { recordingId: string; startedAt: string } | null;
}

interface ThumbnailEntry {
  jpegBase64: string;
  capturedAt: string;
}

interface CameraState {
  id: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  irMode: 'off' | 'on' | 'auto';
  irEnabled: boolean;
  irStrength: number;
  irActiveStrength: number | null;
  pan: number;
  tilt: number;
  temperatureC: number | null;
  recording: boolean;
  // MOTION DETECTION LOGIC (start)
  motionDetected: boolean;
  lastMotionAt: string | null;
  // MOTION DETECTION LOGIC (end)
  measuredFps: number | null;
  lastFrameAgeMs: number | null;
  zoomLevel: number | null;
  updatedAt: string;
}

interface ControlSessionState {
  userId: string;
  userName: string;
  acquiredAt: string;
  expiresAt: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;
const PTZ_HOLD_INTERVAL_MS = 250;

const PREVIEW_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

type CommandAction =
  | 'panLeft'
  | 'panRight'
  | 'tiltUp'
  | 'tiltDown'
  | 'panStartLeft'
  | 'panStartRight'
  | 'panStop'
  | 'irOn'
  | 'irOff'
  | 'recordStart'
  | 'recordStop';

// Positional press-and-hold for all four axes. Each held button fires the
// matching action every PTZ_HOLD_INTERVAL_MS; the Pi Zero translates each
// command into a ±PTZ_STEP° step on the matching servo.
type PtzAction = 'tiltUp' | 'tiltDown' | 'panLeft' | 'panRight';

// MOTION DETECTION LOGIC (start) — only consumer was motionLabel; verified via grep
// const formatRelativeAgo = (iso: string | null, now: number): string => {
//   if (!iso) return '—';
//   const ms = now - Date.parse(iso);
//   if (!Number.isFinite(ms) || ms < 0) return '—';
//   const seconds = Math.floor(ms / 1000);
//   if (seconds < 60) return `${String(seconds)}s`;
//   const minutes = Math.floor(seconds / 60);
//   if (minutes < 60) return `${String(minutes)}m`;
//   const hours = Math.floor(minutes / 60);
//   if (hours < 24) return `${String(hours)}h`;
//   return `${String(Math.floor(hours / 24))}d`;
// };
// MOTION DETECTION LOGIC (end)

const formatTimeUntil = (iso: string | null, now: number): string => {
  if (!iso) return '—';
  const ms = Math.max(0, Date.parse(iso) - now);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
};

const formatRecordingDuration = (startIso: string | null): string => {
  if (!startIso) return '00:00:00';
  const elapsed = Math.max(0, Date.now() - Date.parse(startIso));
  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export default function CamerasPage({ params, searchParams }: PageProps) {
  const translate = useTranslator();
  const { session } = useSession();
  const { upsertSyncEventCallback } = useSyncEvents();

  const previewPeerRef = useRef<RTCPeerConnection | null>(null);
  const previewPeerIdRef = useRef<string | null>(null);
  const previewPeerCameraIdRef = useRef<string | null>(null);
  const previewStartingRef = useRef<boolean>(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewAudioStreamRef = useRef<MediaStream | null>(null);
  // Audio sender on the WebRTC peer. Stored so the mic toggle can swap the
  // local media track in/out via replaceTrack without renegotiating SDP.
  const audioSenderRef = useRef<RTCRtpSender | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnimationFrameRef = useRef<number | null>(null);

  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingState, setLoadingState] = useState<boolean>(false);
  const [previewStarting, setPreviewStarting] = useState<boolean>(false);
  const [previewActive, setPreviewActive] = useState<boolean>(false);
  const [previewStatusKey, setPreviewStatusKey] = useState<string>('cameras.previewIdle');
  const [previewErrorKey, setPreviewErrorKey] = useState<string | null>(null);

  const [cameras, setCameras] = useState<CameraListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<string, ThumbnailEntry>>(new Map());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [lastCommandResult, setLastCommandResult] = useState<{
    commandId: string;
    action: string;
    result: 'accepted' | 'rejected' | 'executed' | 'failed';
    reasonCode?: string;
  } | null>(null);

  const [outputAudioEnabled, setOutputAudioEnabled] = useState<boolean>(true);
  const [uplinkMicEnabled, setUplinkMicEnabled] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  // Mic ownership broadcast by the server. Null = nobody has mic enabled on
  // this camera. When set to a userId other than session.id, the talk button
  // is disabled and we surface "<name> is talking" in the UI.
  const [micEnabledByUser, setMicEnabledByUser] = useState<{ userId: string; userName: string } | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [recordingDurationLabel, setRecordingDurationLabel] = useState<string>('00:00:00');
  const seededRecordingForCameraIdRef = useRef<string | null>(null);
  const [recordingPending, setRecordingPending] = useState<'start' | 'stop' | null>(null);

  // HARDWARE IR SENSOR DELEGATION (start) — slider hidden in UI, this state and its
  // setIRStrength callback are unused. Kept (with _ prefix to satisfy noUnusedLocals)
  // so a future revert just needs to remove the prefix.
  const [_irStrengthDraft, setIrStrengthDraft] = useState<number | null>(null);
  // HARDWARE IR SENSOR DELEGATION (end)

  // Admin-only per-camera debug logging flags. Map of cameraId -> Set of
  // active feature names. Hydrated lazily on camera select; updated via the
  // logFlagsUpdated sync event so multiple admin tabs stay aligned.
  const [logFlagsByCamera, setLogFlagsByCamera] = useState<Record<string, string[]>>({});

  // Control session — null = no one, otherwise { userId, name, expiresAt }.
  const [controlSession, setControlSession] = useState<ControlSessionState | null>(null);
  const [acquiringControl, setAcquiringControl] = useState<boolean>(false);
  const [releasingControl, setReleasingControl] = useState<boolean>(false);

  // Pure client-side CSS-zoom on the preview video. Reset on camera switch.
  const [previewZoom, setPreviewZoom] = useState<number>(1);

  // Wall-clock tick used for relative timestamps (motion ago, control TTL).
  const [now, setNow] = useState<number>(() => Date.now());

  // Hold-to-move PTZ — interval ref so onPointerDown/Up can stop the loop.
  const ptzHoldTimerRef = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);

  const forcedCameraId = params?.id ?? params?.cameraId ?? params?.cameraid ?? searchParams?.cameraId ?? searchParams?.id ?? null;

  const clearPreviewVideoElement = useCallback(() => {
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    if (previewAudioRef.current) previewAudioRef.current.srcObject = null;
  }, []);

  const stopPreviewStream = useCallback(() => {
    if (previewStreamRef.current) {
      for (const track of previewStreamRef.current.getTracks()) {
        track.stop();
      }
      previewStreamRef.current = null;
    }
    if (previewAudioStreamRef.current) {
      for (const track of previewAudioStreamRef.current.getTracks()) {
        track.stop();
      }
      previewAudioStreamRef.current = null;
    }
  }, []);

  const stopPreviewConnection = useCallback(() => {
    if (!previewPeerRef.current) return;
    previewPeerRef.current.ontrack = null;
    previewPeerRef.current.onconnectionstatechange = null;
    previewPeerRef.current.close();
    previewPeerRef.current = null;
    audioSenderRef.current = null;

    const peerId = previewPeerIdRef.current;
    const cameraId = previewPeerCameraIdRef.current;
    previewPeerIdRef.current = null;
    previewPeerCameraIdRef.current = null;
    if (peerId && cameraId) {
      void apiRequest({
        name: 'cameras/webrtc/close',
        version: 'v1',
        data: { cameraId, peerId },
      });
    }
  }, []);

  const stopPreview = useCallback(() => {
    stopPreviewConnection();
    stopPreviewStream();
    clearPreviewVideoElement();
    previewStartingRef.current = false;
    setPreviewStarting(false);
    setPreviewActive(false);
    setPreviewStatusKey('cameras.previewStopped');
  }, [clearPreviewVideoElement, stopPreviewConnection, stopPreviewStream]);

  const waitForIceGathering = useCallback((peerConnection: RTCPeerConnection): Promise<void> => {
    if (peerConnection.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const handleGatheringChange = () => {
        if (peerConnection.iceGatheringState !== 'complete') return;
        peerConnection.removeEventListener('icegatheringstatechange', handleGatheringChange);
        resolve();
      };
      peerConnection.addEventListener('icegatheringstatechange', handleGatheringChange);
      globalThis.setTimeout(() => {
        peerConnection.removeEventListener('icegatheringstatechange', handleGatheringChange);
        resolve();
      }, 1500);
    });
  }, []);

  const selectedCamera = useMemo(() => {
    if (!selectedCameraId) return null;
    return cameras.find((camera) => camera.id === selectedCameraId) ?? null;
  }, [cameras, selectedCameraId]);

  const loadCameras = useCallback(async () => {
    setLoadingList(true);
    const response = await apiRequest({
      name: 'cameras/getCameraList',
      version: 'v1',
      data: {},
    });

    if (response.status === 'success') {
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
      setSelectedCameraId((previous) => {
        if (forcedCameraId && response.cameras.some((camera) => camera.id === forcedCameraId)) {
          return forcedCameraId;
        }
        if (previous && response.cameras.some((camera) => camera.id === previous)) return previous;
        return response.cameras[0]?.id ?? null;
      });
      setLoadingList(false);
      return;
    }

    setLoadingList(false);
    notify.error({ key: response.errorCode });
  }, [forcedCameraId]);

  const loadCameraState = useCallback(async (cameraId: string) => {
    setLoadingState(true);
    const response = await apiRequest({
      name: 'cameras/getCameraState',
      version: 'v1',
      data: { cameraId },
    });

    if (response.status === 'success') {
      setCameraState(response.camera);
      setLoadingState(false);
      return;
    }

    setLoadingState(false);
    setCameraState(null);
    notify.error({ key: response.errorCode });
  }, []);

  useEffect(() => { void loadCameras(); }, [loadCameras]);

  useEffect(() => {
    if (!forcedCameraId) return;
    setSelectedCameraId(forcedCameraId);
  }, [forcedCameraId]);

  useEffect(() => {
    if (!selectedCameraId) {
      stopPreview();
      setCameraState(null);
      setPreviewErrorKey(null);
      setPreviewStatusKey('cameras.previewIdle');
      return;
    }

    stopPreview();
    setPreviewErrorKey(null);
    setPreviewStatusKey('cameras.previewIdle');
    void loadCameraState(selectedCameraId);
  }, [selectedCameraId, loadCameraState, stopPreview]);

  useEffect(() => {
    if (!selectedCameraId) {
      seededRecordingForCameraIdRef.current = null;
      setRecordingStartedAt(null);
      setRecordingPending(null);
      return;
    }

    if (seededRecordingForCameraIdRef.current === selectedCameraId) return;

    const target = cameras.find((camera) => camera.id === selectedCameraId);
    if (!target) return;

    setRecordingStartedAt(target.activeRecording?.startedAt ?? null);
    setRecordingPending(null);
    seededRecordingForCameraIdRef.current = selectedCameraId;
  }, [selectedCameraId, cameras]);

  useEffect(() => () => { stopPreview(); }, [stopPreview]);

  useEffect(() => {
    void joinRoom('cameras-overview');
    return () => { void leaveRoom('cameras-overview'); };
  }, []);

  useEffect(() => {
    if (!selectedCameraId) return;
    const roomCode = `camera-${selectedCameraId}`;
    void joinRoom(roomCode);
    return () => { void leaveRoom(roomCode); };
  }, [selectedCameraId]);

  // Hydrate the debug logging panel for the selected camera (admin only). The
  // store is in-memory so we always re-fetch when switching cameras and on
  // any reload of this page.
  useEffect(() => {
    if (!selectedCameraId || !session?.admin) return;
    void (async () => {
      const response = await apiRequest({
        name: 'cameras/getLogFlags',
        version: 'v1',
        data: { cameraId: selectedCameraId },
      });
      if (response.status !== 'success') return;
      setLogFlagsByCamera((previous) => ({
        ...previous,
        [response.cameraId]: response.features,
      }));
    })();
  }, [selectedCameraId, session?.admin]);

  const toggleLogFlag = useCallback(async (feature: string, enabled: boolean) => {
    if (!selectedCameraId) return;
    const response = await apiRequest({
      name: 'cameras/setLogFlag',
      version: 'v1',
      data: { cameraId: selectedCameraId, feature, enabled },
    });
    if (response.status !== 'success') {
      notify.error({ key: response.errorCode });
      return;
    }
    setLogFlagsByCamera((previous) => ({
      ...previous,
      [response.cameraId]: response.features,
    }));
  }, [selectedCameraId]);

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
            ...(serverOutput.patch.irStrength === undefined ? {} : { irStrength: serverOutput.patch.irStrength ?? 100 }),
            ...(serverOutput.patch.targetFps === undefined ? {} : { targetFps: serverOutput.patch.targetFps }),
            ...(serverOutput.patch.quality === undefined ? {} : { quality: serverOutput.patch.quality }),
            ...(serverOutput.patch.capabilities === undefined ? {} : { capabilities: serverOutput.patch.capabilities }),
          };
        }));

        if (selectedCameraId !== serverOutput.cameraId) return;

        setCameraState((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            ...(typeof serverOutput.patch.isOnline === 'boolean' ? { isOnline: serverOutput.patch.isOnline } : {}),
            ...(serverOutput.patch.mode === undefined ? {} : { mode: serverOutput.patch.mode }),
            ...(serverOutput.patch.irMode === undefined ? {} : { irMode: serverOutput.patch.irMode }),
            ...(serverOutput.patch.irEnabled === undefined ? {} : { irEnabled: serverOutput.patch.irEnabled }),
            ...(serverOutput.patch.irStrength === undefined ? {} : { irStrength: serverOutput.patch.irStrength ?? 100 }),
            ...(serverOutput.patch.irActiveStrength === undefined ? {} : { irActiveStrength: serverOutput.patch.irActiveStrength }),
            ...(serverOutput.patch.pan === undefined ? {} : { pan: serverOutput.patch.pan }),
            ...(serverOutput.patch.tilt === undefined ? {} : { tilt: serverOutput.patch.tilt }),
            ...(serverOutput.patch.temperatureC === undefined ? {} : { temperatureC: serverOutput.patch.temperatureC }),
            // MOTION DETECTION LOGIC (start)
            // ...(serverOutput.patch.motionDetected === undefined ? {} : { motionDetected: serverOutput.patch.motionDetected }),
            // ...(serverOutput.patch.lastMotionAt === undefined ? {} : { lastMotionAt: serverOutput.patch.lastMotionAt }),
            // MOTION DETECTION LOGIC (end)
            ...(serverOutput.patch.recording === undefined ? {} : { recording: serverOutput.patch.recording }),
            ...(serverOutput.patch.measuredFps === undefined ? {} : { measuredFps: serverOutput.patch.measuredFps }),
            ...(serverOutput.patch.lastFrameAgeMs === undefined ? {} : { lastFrameAgeMs: serverOutput.patch.lastFrameAgeMs }),
            ...(serverOutput.patch.zoomLevel === undefined ? {} : { zoomLevel: serverOutput.patch.zoomLevel }),
            updatedAt: serverOutput.at,
          };
        });
      },
    });

    const unsubscribeCommand = upsertSyncEventCallback({
      name: 'cameras/cameraCommandResult',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (selectedCameraId !== serverOutput.cameraId) return;
        setLastCommandResult({
          commandId: serverOutput.commandId,
          action: serverOutput.action,
          result: serverOutput.result,
          reasonCode: serverOutput.reasonCode,
        });
      },
    });

    const unsubscribeForcedLeave = upsertSyncEventCallback({
      name: 'admin/camera-access/userForcedLeaveCameraRoom',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (!session?.id || session.id !== serverOutput.userId) return;
        notify.error({ key: serverOutput.reasonCode || 'camera.accessDenied' });
        if (selectedCameraId === serverOutput.cameraId) {
          stopPreview();
          setSelectedCameraId(null);
          setCameraState(null);
        }
      },
    });

    const unsubscribeLogFlags = upsertSyncEventCallback({
      name: 'cameras/logFlagsUpdated',
      version: 'v1',
      callback: ({ serverOutput }) => {
        setLogFlagsByCamera((previous) => ({
          ...previous,
          [serverOutput.cameraId]: serverOutput.features,
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
        if (selectedCameraId !== serverOutput.cameraId) return;
        if (serverOutput.recordingId && serverOutput.startedAt) {
          setRecordingStartedAt(serverOutput.startedAt);
        } else {
          setRecordingStartedAt(null);
        }
        setRecordingPending(null);
      },
    });

    const unsubscribeControlSession = upsertSyncEventCallback({
      name: 'cameras/controlSession',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (selectedCameraId !== serverOutput.cameraId) return;
        setControlSession(serverOutput.session ?? null);
      },
    });

    const unsubscribeMicEnabled = upsertSyncEventCallback({
      name: 'cameras/micEnabledChanged',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (selectedCameraId !== serverOutput.cameraId) return;
        if (serverOutput.enabled && serverOutput.userId) {
          setMicEnabledByUser({
            userId: serverOutput.userId,
            userName: serverOutput.userName ?? '',
          });
          // Someone else owns the mic — make sure our own toggle reflects
          // that we're not currently talking. Idempotent if it was already off.
          if (serverOutput.userId !== session?.id) {
            setUplinkMicEnabled(false);
          }
        } else {
          setMicEnabledByUser(null);
        }
      },
    });

    return () => {
      unsubscribeState();
      unsubscribeCommand();
      unsubscribeForcedLeave();
      unsubscribeLogFlags();
      unsubscribeThumbnail();
      unsubscribeRecording();
      unsubscribeControlSession();
      unsubscribeMicEnabled();
    };
  }, [selectedCameraId, session?.id, stopPreview, upsertSyncEventCallback]);

  // Wipe control session state on camera switch — server broadcasts the
  // current state on the room subscribe so we don't show stale info.
  useEffect(() => {
    setControlSession(null);
    setMicEnabledByUser(null);
    setUplinkMicEnabled(false);
    setPreviewZoom(1);
  }, [selectedCameraId]);

  // Tick `now` every second so the motion-ago label and control-TTL countdown stay live.
  useEffect(() => {
    const interval = globalThis.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { globalThis.clearInterval(interval); };
  }, []);

  const sendCommand = useCallback(async (action: CommandAction) => {
    if (!selectedCameraId) return;
    const response = await apiRequest({
      name: 'cameras/executeCameraCommand',
      version: 'v1',
      data: {
        cameraId: selectedCameraId,
        commandId: globalThis.crypto.randomUUID(),
        action,
      },
    });

    if (response.status === 'success') {
      setLastCommandResult({
        commandId: response.command.commandId,
        action: response.command.action,
        result: response.command.status,
      });
      return;
    }

    // Per-action 200ms PTZ lock occasionally rejects a too-fast hold tick —
    // that's expected and shouldn't toast every time. Other errors still notify.
    if (response.errorCode === 'camera.locked') return;
    notify.error({ key: response.errorCode });
  }, [selectedCameraId]);

  const setIRMode = useCallback(async (irMode: 'off' | 'on' | 'auto') => {
    if (!selectedCameraId) return;
    const response = await apiRequest({
      name: 'cameras/setIRMode',
      version: 'v1',
      data: { cameraId: selectedCameraId, irMode },
    });
    if (response.status === 'error') notify.error({ key: response.errorCode });
  }, [selectedCameraId]);

  // HARDWARE IR SENSOR DELEGATION (start) — slider hidden in UI; setIRStrength
  // and its debounce ref are unused. Kept for easy revert (uncomment the slider
  // JSX in the IR section to restore).
  const irStrengthCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trailing-edge debounce on the slider commit: when the user nudges the
  // slider repeatedly, only the most recent value lands in the API call. The
  // server-side coalescing in cameraNode.enqueueCommand handles the multi-tab
  // case; this just keeps the network quiet for one user holding the slider.
  const _setIRStrength = useCallback((strength: number) => {
    if (!selectedCameraId) return;
    setIrStrengthDraft(strength);
    if (irStrengthCommitTimeoutRef.current) {
      clearTimeout(irStrengthCommitTimeoutRef.current);
    }
    irStrengthCommitTimeoutRef.current = setTimeout(() => {
      irStrengthCommitTimeoutRef.current = null;
      void (async () => {
        const response = await apiRequest({
          name: 'cameras/setIRStrength',
          version: 'v1',
          data: { cameraId: selectedCameraId, strength },
        });
        if (response.status === 'error') {
          setIrStrengthDraft(null);
          notify.error({ key: response.errorCode });
          return;
        }
        // Sync event will refresh cameraState shortly; clear the draft so any
        // external change (another operator, auto-mode commit) wins.
        setIrStrengthDraft(null);
      })();
    }, 250);
  }, [selectedCameraId]);
  void _setIRStrength; // satisfies noUnusedLocals; remove when restoring slider
  // HARDWARE IR SENSOR DELEGATION (end)

  useEffect(() => {
    return () => {
      if (irStrengthCommitTimeoutRef.current) {
        clearTimeout(irStrengthCommitTimeoutRef.current);
      }
    };
  }, []);

  const setRecording = useCallback(async (recording: boolean) => {
    if (!selectedCameraId) return;
    setRecordingPending(recording ? 'start' : 'stop');
    const response = await apiRequest({
      name: 'cameras/setRecordingMode',
      version: 'v1',
      data: { cameraId: selectedCameraId, recording },
    });
    if (response.status === 'error') {
      setRecordingPending(null);
      notify.error({ key: response.errorCode });
    }
  }, [selectedCameraId]);

  const acquireControl = useCallback(async ({ takeOver }: { takeOver: boolean }) => {
    if (!selectedCameraId) return;
    setAcquiringControl(true);
    const response = await apiRequest({
      name: 'cameras/acquireControl',
      version: 'v1',
      data: { cameraId: selectedCameraId, takeOver },
    });
    setAcquiringControl(false);
    if (response.status === 'error') {
      notify.error({
        key: response.errorCode,
        ...('errorParams' in response ? { params: response.errorParams } : {}),
      });
      return;
    }
    setControlSession({
      userId: response.session.userId,
      userName: response.session.userName,
      acquiredAt: response.session.acquiredAt,
      expiresAt: response.session.expiresAt,
    });
  }, [selectedCameraId]);

  const releaseControl = useCallback(async () => {
    if (!selectedCameraId) return;
    setReleasingControl(true);
    const response = await apiRequest({
      name: 'cameras/releaseControl',
      version: 'v1',
      data: { cameraId: selectedCameraId },
    });
    setReleasingControl(false);
    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
      return;
    }
    setControlSession(null);
  }, [selectedCameraId]);

  const handleTakeControl = useCallback(async () => {
    if (!selectedCameraId) return;
    if (controlSession && controlSession.userId !== session?.id) {
      const confirmed = await confirmDialog({
        title: translate({ key: 'aperture.monitor.confirmTakeOverTitle' }),
        content: translate({ key: 'aperture.monitor.confirmTakeOverBody' }).replace('{{name}}', controlSession.userName),
      });
      if (!confirmed) return;
      await acquireControl({ takeOver: true });
      return;
    }
    await acquireControl({ takeOver: false });
  }, [acquireControl, controlSession, selectedCameraId, session?.id, translate]);

  const stopPtzHold = useCallback(() => {
    if (ptzHoldTimerRef.current === null) return;
    globalThis.clearInterval(ptzHoldTimerRef.current);
    ptzHoldTimerRef.current = null;
  }, []);

  const startPtzHold = useCallback((action: PtzAction) => {
    stopPtzHold();
    // Fire once immediately, then on a 250ms cadence while the button is held.
    // The server's 200ms PTZ cooldown lets this rhythm flow without rejection.
    void sendCommand(action);
    ptzHoldTimerRef.current = globalThis.setInterval(() => {
      void sendCommand(action);
    }, PTZ_HOLD_INTERVAL_MS);
  }, [sendCommand, stopPtzHold]);

  // Stop any in-flight PTZ hold when the user navigates away or switches cameras.
  useEffect(() => () => { stopPtzHold(); }, [stopPtzHold]);
  useEffect(() => { stopPtzHold(); }, [selectedCameraId, stopPtzHold]);

  // Auto-release control on unmount or camera switch. Best-effort fire-and-
  // forget: if the socket is already gone, the server's TTL cleans up.
  useEffect(() => {
    if (!selectedCameraId) return;
    const cameraId = selectedCameraId;
    return () => {
      void apiRequest({
        name: 'cameras/releaseControl',
        version: 'v1',
        data: { cameraId },
      });
    };
  }, [selectedCameraId]);

  const startPreview = useCallback(async () => {
    if (!selectedCameraId) return;
    if (!('RTCPeerConnection' in globalThis)) {
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('cameras.previewUnsupported');
      notify.error({ key: 'cameras.previewUnsupported' });
      return;
    }

    if (previewStartingRef.current) return;

    stopPreview();
    previewStartingRef.current = true;
    setPreviewStarting(true);
    setPreviewStatusKey('cameras.previewConnecting');
    setPreviewErrorKey(null);

    const [peerCreateError, peerConnection] = await tryCatch(() => new RTCPeerConnection({ iceServers: PREVIEW_ICE_SERVERS }));

    if (peerCreateError || !peerConnection) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      return;
    }

    previewPeerRef.current = peerConnection;
    peerConnection.addTransceiver('video', { direction: 'recvonly' });
    // Audio is sendrecv from the start so the mic toggle can swap a local
    // track in via replaceTrack without renegotiating SDP. Until the toggle
    // turns on, the sender stays attached to a null track and emits nothing.
    const audioTransceiver = peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
    audioSenderRef.current = audioTransceiver.sender;

    peerConnection.ontrack = (event) => {
      const incomingTrack = event.track;
      if (incomingTrack.kind === 'video') {
        const firstStream = event.streams[0] ?? new MediaStream([incomingTrack]);
        previewStreamRef.current = firstStream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = firstStream;
          previewVideoRef.current.muted = !outputAudioEnabled;
        }
        setPreviewActive(true);
        previewStartingRef.current = false;
        setPreviewStarting(false);
        setPreviewStatusKey('cameras.previewConnected');
        return;
      }
      if (incomingTrack.kind === 'audio') {
        // Camera-mic downlink: always-on listening for any client. Volume
        // is governed by the user's device volume, not an in-app slider, so
        // the audio element starts unmuted at default volume. The existing
        // outputAudioEnabled toggle still controls per-tab mute.
        const audioStream = event.streams[0] ?? new MediaStream([incomingTrack]);
        previewAudioStreamRef.current = audioStream;
        if (previewAudioRef.current) {
          previewAudioRef.current.srcObject = audioStream;
          previewAudioRef.current.muted = !outputAudioEnabled;
          // play() can reject if the user hasn't interacted yet — they have,
          // by clicking into the camera, but be defensive about deep links.
          void previewAudioRef.current.play().catch(() => {
            /* autoplay blocked; user can click anywhere to unblock */
          });
        }
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        stopPreview();
      }
    };

    const [offerCreateError, offer] = await tryCatch(async () => peerConnection.createOffer());

    if (offerCreateError || !offer) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      stopPreview();
      return;
    }

    const [localDescriptionError] = await tryCatch(async () => peerConnection.setLocalDescription(offer));
    if (localDescriptionError) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      stopPreview();
      return;
    }

    await waitForIceGathering(peerConnection);

    const offerSdp = peerConnection.localDescription?.sdp.trim();
    if (!offerSdp) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      stopPreview();
      return;
    }

    const offerResponse = await apiRequest({
      name: 'cameras/webrtc/offer',
      version: 'v1',
      data: { cameraId: selectedCameraId, offerSdp },
    });

    if (offerResponse.status === 'error') {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey(offerResponse.errorCode);
      notify.error({ key: offerResponse.errorCode });
      stopPreview();
      return;
    }

    if (previewPeerRef.current !== peerConnection) {
      if (offerResponse.peerId) {
        void apiRequest({
          name: 'cameras/webrtc/close',
          version: 'v1',
          data: { cameraId: selectedCameraId, peerId: offerResponse.peerId },
        });
      }
      return;
    }

    previewPeerIdRef.current = offerResponse.peerId;
    previewPeerCameraIdRef.current = selectedCameraId;

    const [remoteDescriptionError] = await tryCatch(async () => peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: offerResponse.answerSdp,
    }));

    if (remoteDescriptionError) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      stopPreview();
      return;
    }

    for (const candidate of offerResponse.iceCandidates) {
      await tryCatch(async () => peerConnection.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      }));
    }

    previewStartingRef.current = false;
    setPreviewStarting(false);
    setPreviewActive(true);
    setPreviewStatusKey('cameras.previewConnected');
  }, [outputAudioEnabled, selectedCameraId, stopPreview, waitForIceGathering]);

  useEffect(() => {
    if (!selectedCameraId || !selectedCamera?.canPreview) return;
    if (previewActive || previewStarting) return;
    void startPreview();
  }, [selectedCameraId, selectedCamera?.canPreview, previewActive, previewStarting, startPreview]);

  useEffect(() => {
    if (!recordingStartedAt) {
      setRecordingDurationLabel('00:00:00');
      return;
    }
    setRecordingDurationLabel(formatRecordingDuration(recordingStartedAt));
    const interval = globalThis.setInterval(() => {
      setRecordingDurationLabel(formatRecordingDuration(recordingStartedAt));
    }, 1000);
    return () => { globalThis.clearInterval(interval); };
  }, [recordingStartedAt]);

  useEffect(() => {
    const stopMicCapture = () => {
      if (micAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(micAnimationFrameRef.current);
        micAnimationFrameRef.current = null;
      }
      if (micStreamRef.current) {
        for (const track of micStreamRef.current.getTracks()) {
          track.stop();
        }
        micStreamRef.current = null;
      }
      if (micAudioContextRef.current) {
        void micAudioContextRef.current.close();
        micAudioContextRef.current = null;
      }
      setMicLevel(0);
      // Detach mic from the WebRTC sender so the camera speaker goes silent.
      if (audioSenderRef.current) {
        void audioSenderRef.current.replaceTrack(null).catch(() => {
          /* sender may have been torn down with the peer */
        });
      }
    };

    if (!selectedCameraId) {
      stopMicCapture();
      return;
    }

    if (!uplinkMicEnabled) {
      stopMicCapture();
      // Best-effort tell the server the mic is off. If we never enabled it
      // server-side this is a no-op; if we did, this releases the redis lock.
      void apiRequest({
        name: 'cameras/setMicEnabled',
        version: 'v1',
        data: { cameraId: selectedCameraId, enabled: false },
      });
      return;
    }

    let cancelled = false;

    const startMicCapture = async () => {
      // Server-side gate first — ensures we hold the control session and the
      // mic-enabled redis lock before fighting the user for mic permission.
      const apiResponse = await apiRequest({
        name: 'cameras/setMicEnabled',
        version: 'v1',
        data: { cameraId: selectedCameraId, enabled: true },
      });
      if (apiResponse.status === 'error') {
        setUplinkMicEnabled(false);
        notify.error({ key: apiResponse.errorCode });
        return;
      }
      if (cancelled) return;

      const [streamError, stream] = await tryCatch(async () =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        }),
      );

      if (streamError || !stream) {
        setUplinkMicEnabled(false);
        // Roll back the server-side lock so other users can talk.
        void apiRequest({
          name: 'cameras/setMicEnabled',
          version: 'v1',
          data: { cameraId: selectedCameraId, enabled: false },
        });
        notify.error({ key: 'camera.unexpectedError' });
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      micStreamRef.current = stream;

      // Push mic into the WebRTC peer so server-side werift starts receiving
      // RTP and forwarding it to the Pi Zero's audio_subscriber.
      const micTrack = stream.getAudioTracks()[0];
      if (micTrack && audioSenderRef.current) {
        await tryCatch(async () => audioSenderRef.current!.replaceTrack(micTrack));
      }

      const audioContext = new AudioContext();
      micAudioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (const value of dataArray) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const nextLevel = Math.min(100, Math.round(rms * 240));
        setMicLevel(nextLevel);
        micAnimationFrameRef.current = globalThis.requestAnimationFrame(tick);
      };

      tick();
    };

    void startMicCapture();

    return () => {
      cancelled = true;
      stopMicCapture();
    };
  }, [uplinkMicEnabled, selectedCameraId]);

  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.muted = !outputAudioEnabled;
    if (previewAudioRef.current) previewAudioRef.current.muted = !outputAudioEnabled;
  }, [outputAudioEnabled, previewActive]);

  const isController = controlSession?.userId === session?.id && !!session?.id;
  const canTakeControl = !!selectedCamera?.canControl;
  const controlsDisabled = !isController;
  const caps = selectedCamera?.capabilities ?? null;
  const irDisabled = controlsDisabled || !(caps?.hasIR ?? true);
  const panTiltDisabled = controlsDisabled || !(caps?.hasPanTilt ?? true);
  // Zoom is now client-side CSS scale — no Pi Zero round-trip, no hardware
  // dependency. Only blocked while the user isn't the controller.
  const zoomDisabled = controlsDisabled;
  // Mic toggle is gated by control + speaker hardware + ownership: if someone
  // else has their mic enabled on this camera, we lock the toggle out so only
  // one person can talk at a time.
  const someoneElseTalking =
    micEnabledByUser !== null && micEnabledByUser.userId !== (session?.id ?? '');
  const talkbackDisabled =
    controlsDisabled || !(caps?.hasSpeaker ?? true) || someoneElseTalking;
  const talkingLabel = someoneElseTalking
    ? translate({ key: 'aperture.monitor.audioMicHeldByOther' }).replace('{{name}}', micEnabledByUser?.userName || '')
    : null;
  const sysAudioDisabled = !(caps?.hasMicrophone ?? true);

  const fpsLabel = useMemo(() => {
    const measured = cameraState?.measuredFps;
    if (measured === null || measured === undefined) return '—';
    return `${String(Math.round(measured))}FPS`;
  }, [cameraState?.measuredFps]);

  const qualityLabel = useMemo(() => {
    if (!selectedCamera) return '—';
    return selectedCamera.quality.toUpperCase();
  }, [selectedCamera]);

  // Client-side preview zoom (CSS scale). 1×..ZOOM_MAX×.
  const zoomPercent = ((previewZoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;
  const zoomLabel = `${previewZoom.toFixed(1)}×`;

  // MOTION DETECTION LOGIC (locale keys live in en/nl/de/fr.json: aperture.monitor.motion, motionActive, motionLastSeen, motionNeverSeen, motionDisabled, aperture.recordings.filterMotion, aperture.dashboard.motion — left as harmless dead strings while paused)
  // MOTION DETECTION LOGIC (start)
  // const motionLabel = useMemo(() => {
  //   if (!(caps?.hasMotion ?? false)) return translate({ key: 'aperture.monitor.motionDisabled' });
  //   if (cameraState?.motionDetected) return translate({ key: 'aperture.monitor.motionActive' });
  //   if (cameraState?.lastMotionAt) {
  //     return translate({ key: 'aperture.monitor.motionLastSeen' })
  //       .replace('{{ago}}', formatRelativeAgo(cameraState.lastMotionAt, now));
  //   }
  //   return translate({ key: 'aperture.monitor.motionNeverSeen' });
  // }, [caps?.hasMotion, cameraState?.motionDetected, cameraState?.lastMotionAt, now, translate]);
  // MOTION DETECTION LOGIC (end)
  const zoomInDisabled = zoomDisabled || previewZoom >= ZOOM_MAX;
  const zoomOutDisabled = zoomDisabled || previewZoom <= ZOOM_MIN;
  const handleZoomIn = useCallback(() => {
    setPreviewZoom((current) => Math.min(ZOOM_MAX, Math.round((current + ZOOM_STEP) * 10) / 10));
  }, []);
  const handleZoomOut = useCallback(() => {
    setPreviewZoom((current) => Math.max(ZOOM_MIN, Math.round((current - ZOOM_STEP) * 10) / 10));
  }, []);

  let recordingActive: boolean;
  if (recordingPending === 'start') {
    recordingActive = true;
  } else if (recordingPending === 'stop') {
    recordingActive = false;
  } else {
    recordingActive = recordingStartedAt !== null;
  }

  const currentIRMode = cameraState?.irMode ?? selectedCamera?.irMode ?? 'auto';
  // HARDWARE IR SENSOR DELEGATION (start) — slider hidden; these only fed it
  const _currentIRStrength = cameraState?.irStrength ?? selectedCamera?.irStrength ?? 100;
  const _currentIRActiveStrength = cameraState?.irActiveStrength ?? null;
  void _currentIRStrength; void _currentIRActiveStrength; // satisfy noUnusedLocals
  // HARDWARE IR SENSOR DELEGATION (end)

  const previewActionLabel = useMemo(() => {
    if (previewActive || previewStarting) {
      return translate({ key: 'aperture.monitor.reloadPreview' });
    }
    return translate({ key: 'aperture.monitor.startPreview' });
  }, [previewActive, previewStarting, translate]);

  const temperatureLabel = useMemo(() => {
    if (cameraState?.temperatureC === null || cameraState?.temperatureC === undefined) {
      return translate({ key: 'cameras.notAvailable' });
    }
    return `${cameraState.temperatureC.toFixed(1)} °C`;
  }, [cameraState?.temperatureC, translate]);

  const handlePreviewAction = useCallback(() => {
    void startPreview();
  }, [startPreview]);

  const filteredCameras = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) return cameras;
    return cameras.filter((camera) => camera.name.toLowerCase().includes(trimmed) || camera.slug.toLowerCase().includes(trimmed));
  }, [cameras, searchQuery]);

  const requestFullscreen = useCallback(() => {
    if (previewVideoRef.current?.requestFullscreen) {
      void previewVideoRef.current.requestFullscreen();
    }
  }, []);

  const handleSnapshot = useCallback(() => {
    const video = previewVideoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedCamera?.slug ?? 'camera'}-${String(Date.now())}.png`;
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
    });
  }, [selectedCamera?.slug]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-container1-border bg-container1 md:flex">
        <div className="px-5 pb-3 pt-5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
            {translate({ key: 'aperture.monitor.eyebrow' })}
          </div>
          <h2 className="font-display mt-1.5 text-[22px] text-title">{translate({ key: 'aperture.monitor.title' })}</h2>
        </div>
        <div className="px-3.5 pb-2.5">
          <div className="flex items-center gap-2 rounded-[10px] border border-container2-border bg-container2 px-2.5 py-2">
            <MaterialIcon name="search" size={16} className="text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); }}
              placeholder={translate({ key: 'aperture.monitor.searchPlaceholder' })}
              className="flex-1 border-none bg-transparent text-sm text-title outline-none"
            />
          </div>
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto px-2.5 pb-4">
          {loadingList && (
            <div className="px-3 py-3 text-xs text-muted">{translate({ key: 'cameras.loading' })}</div>
          )}
          {!loadingList && filteredCameras.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted">{translate({ key: 'aperture.monitor.noResults' })}</div>
          )}
          {!loadingList && filteredCameras.map((camera) => {
            const active = camera.id === selectedCameraId;
            const offline = !camera.isOnline || camera.mode === 'off';
            const thumbnail = thumbnails.get(camera.id);
            const thumbnailSrc = thumbnail ? `data:image/jpeg;base64,${thumbnail.jpegBase64}` : null;
            return (
              <button
                key={camera.id}
                type="button"
                onClick={() => { setSelectedCameraId(camera.id); }}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors ${active ? 'bg-container2' : 'hover:bg-container2/60'}`}
              >
                <div className="h-8 w-11 shrink-0 overflow-hidden rounded-md bg-container2">
                  {thumbnailSrc ? (
                    <img
                      alt=""
                      src={thumbnailSrc}
                      className="h-full w-full object-cover"
                      style={{ filter: offline ? 'grayscale(1) opacity(0.5)' : undefined }}
                    />
                  ) : (
                    <div className="cam-placeholder h-full w-full" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[12.5px] ${active ? 'font-semibold text-title' : 'font-medium text-title'}`}>{camera.name}</div>
                  <div className="font-mono text-[10.5px] text-muted">{camera.slug}</div>
                </div>
                <StatusDot status={offline ? 'offline' : 'online'} pulse={!offline} />
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!selectedCamera && !loadingList && (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center">
            <MaterialIcon name="videocam" size={36} className="text-muted" />
            <div className="font-display text-[24px] text-title">{translate({ key: 'aperture.monitor.selectPrompt' })}</div>
            <div className="text-sm text-muted">{translate({ key: 'aperture.monitor.selectHint' })}</div>
          </div>
        )}

        {selectedCamera && (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-container1-border px-7 py-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display m-0 text-[26px] text-title">{selectedCamera.name}</h1>
                  <Chip variant={selectedCamera.isOnline ? 'correct' : 'wrong'}>
                    <StatusDot status={selectedCamera.isOnline ? 'online' : 'offline'} pulse={selectedCamera.isOnline} />
                    {selectedCamera.isOnline ? translate({ key: 'aperture.dashboard.live' }) : translate({ key: 'cameras.statusOffline' })}
                  </Chip>
                  {recordingActive && (
                    <Chip variant="wrong">
                      <span className="h-1.5 w-1.5 rounded-full bg-wrong" />
                      {translate({ key: 'aperture.monitor.recording' })} {recordingDurationLabel}
                    </Chip>
                  )}
                </div>
                <div className="mt-1.5 font-mono text-[12.5px] text-muted">
                  {selectedCamera.slug} · {fpsLabel} · {qualityLabel}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestFullscreen}
                  disabled={!previewActive}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover disabled:opacity-50"
                >
                  <MaterialIcon name="fullscreen" size={16} />
                  {translate({ key: 'aperture.monitor.fullscreen' })}
                </button>
                <button
                  type="button"
                  onClick={handleSnapshot}
                  disabled={!previewActive}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3.5 py-2 text-[13px] font-medium text-title transition-colors hover:bg-container1-hover disabled:opacity-50"
                >
                  <MaterialIcon name="photo_camera" size={16} />
                  {translate({ key: 'aperture.monitor.snapshot' })}
                </button>
                <button
                  type="button"
                  onClick={handlePreviewAction}
                  disabled={!selectedCamera.canPreview || previewStarting}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3.5 py-2 text-[13px] font-semibold text-title-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  <MaterialIcon name={previewActive ? 'replay' : 'play_arrow'} size={16} />
                  {previewActionLabel}
                </button>
              </div>
            </header>

            {!selectedCamera.canControl && !loadingList && (
              <div className="border-b border-wrong/30 bg-wrong-soft px-7 py-2 text-xs font-medium text-wrong">
                {translate({ key: 'cameras.controlDisabledHint' })}
              </div>
            )}

            {selectedCamera.canControl && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-container1-border bg-container2/40 px-7 py-2.5">
                <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
                  {isController && (
                    <>
                      <StatusDot status="online" pulse />
                      <span className="font-semibold text-title">{translate({ key: 'aperture.monitor.youAreInControl' })}</span>
                      <span className="font-mono text-[11px] text-muted">
                        · {translate({ key: 'aperture.monitor.controlExpiresIn' }).replace('{{time}}', formatTimeUntil(controlSession?.expiresAt ?? null, now))}
                      </span>
                    </>
                  )}
                  {!isController && controlSession && (
                    <>
                      <StatusDot status="offline" />
                      <span className="text-common">{translate({ key: 'aperture.monitor.controlledBy' }).replace('{{name}}', controlSession.userName)}</span>
                    </>
                  )}
                  {!isController && !controlSession && (
                    <>
                      <StatusDot status="idle" />
                      <span className="text-muted">{translate({ key: 'aperture.monitor.noController' })}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isController ? (
                    <button
                      type="button"
                      onClick={() => { void releaseControl(); }}
                      disabled={releasingControl}
                      className="inline-flex items-center gap-2 rounded-[10px] border border-container1-border bg-container1 px-3 py-1.5 text-[12.5px] font-medium text-title transition-colors hover:bg-container1-hover disabled:opacity-50"
                    >
                      <MaterialIcon name="logout" size={14} />
                      {releasingControl ? translate({ key: 'aperture.monitor.releasing' }) : translate({ key: 'aperture.monitor.release' })}
                    </button>
                  ) : (
                    canTakeControl && (
                      <button
                        type="button"
                        onClick={() => { void handleTakeControl(); }}
                        disabled={acquiringControl}
                        className="inline-flex items-center gap-2 rounded-[10px] border border-primary-border bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-title-primary transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        <MaterialIcon name="pan_tool" size={14} />
                        {controlSession
                          ? translate({ key: 'aperture.monitor.takeOverFrom' }).replace('{{name}}', controlSession.userName)
                          : translate({ key: 'aperture.monitor.takeControl' })}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 lg:grid-cols-[1fr_320px]">
              <section className="relative flex min-h-[18rem] flex-col overflow-hidden rounded-2xl bg-black">
                {!previewActive && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-sm font-semibold text-white/70">
                    <MaterialIcon name={previewStarting ? 'progress_activity' : 'videocam_off'} size={28} />
                    <span>{translate({ key: previewStatusKey })}</span>
                  </div>
                )}

                <video
                  autoPlay
                  className={`h-full w-full object-contain transition-transform duration-150 ${previewActive ? 'block' : 'hidden'}`}
                  controls={false}
                  muted={!outputAudioEnabled}
                  playsInline
                  ref={previewVideoRef}
                  style={{ transform: previewZoom > 1 ? `scale(${String(previewZoom)})` : undefined, transformOrigin: 'center center' }}
                >
                  <track kind="captions" />
                </video>
                {/*
                  Camera-mic downlink. Always-on listening regardless of who
                  has control — volume is controlled by the user's device.
                  Hidden from layout; the audio sink is the only thing we need.
                */}
                <audio
                  autoPlay
                  className="hidden"
                  muted={!outputAudioEnabled}
                  ref={previewAudioRef}
                >
                  <track kind="captions" />
                </audio>

                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.55) 100%)' }}
                />

                <div className="absolute left-3.5 top-3.5 z-30 flex gap-2">
                  <span className="rounded-lg bg-black/55 px-2.5 py-1 font-mono text-[11px] font-semibold text-white backdrop-blur">
                    {qualityLabel} · {fpsLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                    <MaterialIcon name="thermostat" size={13} />
                    {temperatureLabel}
                  </span>
                </div>

                {recordingActive && (
                  <div className="absolute right-3.5 top-3.5 z-30 inline-flex items-center gap-1.5 rounded-lg bg-wrong/85 px-2.5 py-1 backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    <span className="font-mono text-[11px] font-bold text-white">REC {recordingDurationLabel}</span>
                  </div>
                )}

                {/* MOTION DETECTION LOGIC (start) */}
                {/* {cameraState?.motionDetected && (caps?.hasMotion ?? false) && (
                  <div className={`absolute z-30 inline-flex items-center gap-1.5 rounded-lg bg-correct/85 px-2.5 py-1 backdrop-blur ${recordingActive ? 'right-3.5 top-12' : 'right-3.5 top-3.5'}`}>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    <span className="font-mono text-[11px] font-bold text-white">{translate({ key: 'aperture.monitor.motionActive' })}</span>
                  </div>
                )} */}
                {/* MOTION DETECTION LOGIC (end) */}

                <div className="absolute bottom-4 left-4 z-30">
                  <div className="relative h-[140px] w-[140px] rounded-full border border-white/15 bg-black/45 backdrop-blur">
                    {/* PTZ buttons: positional press-and-hold. Each hold ticks at PTZ_HOLD_INTERVAL_MS; one tick = ±PTZ_STEP° on the matching servo. */}
                    {([
                      { dir: 'tiltUp' as PtzAction, icon: 'keyboard_arrow_up', cls: 'absolute left-1/2 top-2 -translate-x-1/2' },
                      { dir: 'tiltDown' as PtzAction, icon: 'keyboard_arrow_down', cls: 'absolute bottom-2 left-1/2 -translate-x-1/2' },
                      { dir: 'panLeft' as PtzAction, icon: 'keyboard_arrow_left', cls: 'absolute left-2 top-1/2 -translate-y-1/2' },
                      { dir: 'panRight' as PtzAction, icon: 'keyboard_arrow_right', cls: 'absolute right-2 top-1/2 -translate-y-1/2' },
                    ]).map((btn) => (
                      <button
                        key={btn.dir}
                        type="button"
                        disabled={panTiltDisabled}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          if (panTiltDisabled) return;
                          startPtzHold(btn.dir);
                        }}
                        onPointerUp={stopPtzHold}
                        onPointerLeave={stopPtzHold}
                        onPointerCancel={stopPtzHold}
                        className={`${btn.cls} flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white disabled:opacity-50`}
                      >
                        <MaterialIcon name={btn.icon} size={20} />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { void loadCameraState(selectedCamera.id); }}
                      className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-primary/85 text-white"
                      aria-label={translate({ key: 'aperture.monitor.ptzCenter' })}
                    >
                      <MaterialIcon name="my_location" size={18} />
                    </button>
                  </div>
                </div>

                <div className="absolute bottom-5 right-5 z-30 flex flex-col items-center gap-2 rounded-xl border border-white/15 bg-black/45 px-2 py-2.5 backdrop-blur">
                  <button
                    type="button"
                    disabled={zoomInDisabled}
                    onClick={handleZoomIn}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-white disabled:opacity-50"
                  >
                    +
                  </button>
                  <div className="relative h-[100px] w-1 rounded-full bg-white/15">
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-full bg-white"
                      style={{ height: `${String(Math.min(100, Math.max(0, zoomPercent)))}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={zoomOutDisabled}
                    onClick={handleZoomOut}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-white disabled:opacity-50"
                  >
                    −
                  </button>
                  <span className="font-mono text-[10px] font-semibold text-white">{zoomLabel}</span>
                </div>

                {previewErrorKey && (
                  <div className="absolute bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-wrong/90 px-3 py-1.5 text-xs font-semibold text-white">
                    {translate({ key: previewErrorKey })}
                  </div>
                )}
              </section>

              <aside className="thin-scroll flex flex-col gap-3 overflow-y-auto pb-2">
                <section className="rounded-2xl border border-container1-border bg-container1 p-4">
                  <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.monitor.telemetry' })}</div>
                  {[
                    { k: translate({ key: 'aperture.monitor.panTilt' }), v: cameraState ? `${String(cameraState.pan)}° / ${String(cameraState.tilt)}°` : '—' },
                    { k: translate({ key: 'aperture.monitor.zoom' }), v: zoomLabel },
                    // MOTION DETECTION LOGIC (start)
                    // { k: translate({ key: 'aperture.monitor.motion' }), v: motionLabel },
                    // MOTION DETECTION LOGIC (end)
                    { k: translate({ key: 'aperture.monitor.frameAge' }), v: cameraState?.lastFrameAgeMs !== null && cameraState?.lastFrameAgeMs !== undefined ? `${String(cameraState.lastFrameAgeMs)} ms` : '—' },
                    { k: translate({ key: 'aperture.monitor.lastCommand' }), v: lastCommandResult ? `${lastCommandResult.action} · ${lastCommandResult.result}` : '—' },
                  ].map((row, index, list) => (
                    <div
                      key={row.k}
                      className={`flex items-center justify-between py-1.5 text-[12.5px] ${index < list.length - 1 ? 'border-b border-container1-border' : ''}`}
                    >
                      <span className="text-muted">{row.k}</span>
                      <span className="font-mono font-medium text-title">{row.v}</span>
                    </div>
                  ))}
                </section>

                <section className="rounded-2xl border border-container1-border bg-container1 p-4">
                  <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.monitor.infrared' })}</div>
                  <div className="flex gap-1 rounded-[10px] bg-container2 p-0.5">
                    {[
                      { mode: 'off' as const, label: translate({ key: 'aperture.monitor.irOff' }) },
                      // HARDWARE IR SENSOR DELEGATION (start) — Auto is now driven by the ring's onboard CdS sensor; uncomment to restore software auto-IR
                      // { mode: 'auto' as const, label: translate({ key: 'aperture.monitor.irAuto' }) },
                      // HARDWARE IR SENSOR DELEGATION (end)
                      { mode: 'on' as const, label: translate({ key: 'aperture.monitor.irOn' }) },
                    ].map((option) => {
                      const active = currentIRMode === option.mode;
                      return (
                        <button
                          key={option.mode}
                          type="button"
                          disabled={irDisabled}
                          onClick={() => { void setIRMode(option.mode); }}
                          className={`flex-1 rounded-[7px] border py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${active ? 'border-container1-border bg-container1 text-title' : 'border-transparent text-common'}`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* HARDWARE IR SENSOR DELEGATION (start) — slider hidden because the ring's CdS sensor controls actual brightness; we have no electrical path to read it. Uncomment to restore the software-controlled slider. */}
                  {/* {currentIRMode !== 'off' && (() => {
                    // 'on' mode: user controls strength via the slider directly.
                    // 'auto' mode: slider mirrors the auto controller's live value
                    //              (irActiveStrength from telemetry) and is read-only.
                    const sliderDisabled = currentIRMode === 'auto' || irDisabled;
                    const displayStrength = currentIRMode === 'auto'
                      ? (currentIRActiveStrength ?? 0)
                      : (irStrengthDraft ?? currentIRStrength);
                    return (
                      <div className="mt-3 flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between text-[11px] text-muted">
                          <span>{translate({ key: 'aperture.monitor.irStrength' })}</span>
                          <span className="font-mono font-medium text-title">{displayStrength}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={displayStrength}
                          disabled={sliderDisabled}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) setIrStrengthDraft(next);
                          }}
                          onPointerUp={(event) => {
                            const next = Number((event.target as HTMLInputElement).value);
                            if (Number.isFinite(next)) {
                              setIRStrength(next);
                            }
                          }}
                          onKeyUp={(event) => {
                            // Keyboard adjustment (arrow keys) won't fire pointerup;
                            // commit on key release for keyboard parity.
                            const next = Number((event.target as HTMLInputElement).value);
                            if (Number.isFinite(next)) {
                              setIRStrength(next);
                            }
                          }}
                          className="h-1.5 w-full cursor-pointer accent-correct disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    );
                  })()} */}
                  {/* HARDWARE IR SENSOR DELEGATION (end) */}
                </section>

                <section className="rounded-2xl border border-container1-border bg-container1 p-4">
                  <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.monitor.audio' })}</div>
                  <div className="flex flex-col gap-2.5">
                    <label className={`flex items-center justify-between text-[12.5px] text-title ${sysAudioDisabled ? 'opacity-50' : ''}`}>
                      <span>{translate({ key: 'aperture.monitor.audioSystem' })}</span>
                      <Toggle
                        on={outputAudioEnabled}
                        disabled={sysAudioDisabled}
                        onChange={setOutputAudioEnabled}
                        ariaLabel={translate({ key: 'aperture.monitor.audioSystem' })}
                      />
                    </label>
                    <label className={`flex items-center justify-between text-[12.5px] text-title ${talkbackDisabled ? 'opacity-50' : ''}`}>
                      <span>{translate({ key: 'aperture.monitor.audioMic' })}</span>
                      <Toggle
                        on={uplinkMicEnabled}
                        disabled={talkbackDisabled}
                        onChange={setUplinkMicEnabled}
                        ariaLabel={translate({ key: 'aperture.monitor.audioMic' })}
                      />
                    </label>
                    {talkingLabel && (
                      <div className="text-[11px] text-muted">{talkingLabel}</div>
                    )}
                    {uplinkMicEnabled && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-container2">
                        <div className="h-full bg-primary transition-all duration-100" style={{ width: `${String(micLevel)}%` }} />
                      </div>
                    )}
                  </div>
                </section>

                {session?.admin && selectedCameraId && (() => {
                  const activeFlags = new Set(logFlagsByCamera[selectedCameraId]);
                  const features: { key: 'ir' | 'recording' | 'performance' | 'streamPipeline' | 'commandQueue' | 'audioPipeline'; label: string }[] = [
                    { key: 'ir', label: translate({ key: 'aperture.monitor.debugFeatureIr' }) },
                    { key: 'recording', label: translate({ key: 'aperture.monitor.debugFeatureRecording' }) },
                    { key: 'performance', label: translate({ key: 'aperture.monitor.debugFeaturePerformance' }) },
                    { key: 'streamPipeline', label: translate({ key: 'aperture.monitor.debugFeatureStream' }) },
                    { key: 'commandQueue', label: translate({ key: 'aperture.monitor.debugFeatureCommands' }) },
                    { key: 'audioPipeline', label: translate({ key: 'aperture.monitor.debugFeatureAudio' }) },
                  ];
                  return (
                    <section className="rounded-2xl border border-container1-border bg-container1 p-4">
                      <div className="mb-3 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                        <span>{translate({ key: 'aperture.monitor.debugLogging' })}</span>
                        <span className="font-mono normal-case tracking-normal text-[10px] text-muted/70">{translate({ key: 'aperture.monitor.debugLoggingHint' })}</span>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {features.map((feature) => (
                          <label key={feature.key} className="flex items-center justify-between text-[12.5px] text-title">
                            <span>{feature.label}</span>
                            <Toggle
                              on={activeFlags.has(feature.key)}
                              onChange={(next) => { void toggleLogFlag(feature.key, next); }}
                              ariaLabel={feature.label}
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })()}

                <section className="rounded-2xl border border-container1-border bg-container1 p-4">
                  <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{translate({ key: 'aperture.monitor.recording' })}</div>
                  <button
                    type="button"
                    disabled={controlsDisabled || recordingPending !== null}
                    onClick={() => { void setRecording(!recordingActive); }}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-[10px] border px-3.5 py-2.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-50 ${recordingActive ? 'border-wrong bg-wrong hover:bg-wrong-hover' : 'border-correct bg-correct hover:bg-correct-hover'}`}
                  >
                    {recordingActive ? (
                      <>
                        <span className="h-2 w-2 rounded-sm bg-white" />
                        {translate({ key: 'aperture.monitor.stopRecording' })}
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="fiber_manual_record" size={16} />
                        {translate({ key: 'aperture.monitor.startRecording' })}
                      </>
                    )}
                  </button>
                  <div className="mt-2.5 text-center text-[11.5px] text-muted">
                    {recordingActive
                      ? translate({ key: 'aperture.monitor.recordingStartedAgo' }).replace('{{elapsed}}', recordingDurationLabel)
                      : translate({ key: 'aperture.monitor.recordingNone' })}
                  </div>
                </section>

                {loadingState && (
                  <div className="rounded-2xl border border-container1-border bg-container1 p-3 text-xs text-muted">
                    {translate({ key: 'cameras.loadingState' })}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
