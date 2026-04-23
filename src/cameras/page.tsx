import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import tryCatch from 'shared/tryCatch';

import Icon from 'src/_components/Icon';
import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'ops';

interface PageProps {
  params?: Record<string, string | undefined>;
  searchParams?: Record<string, string | undefined>;
}

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
}

interface CameraState {
  id: string;
  isOnline: boolean;
  mode: 'off' | 'idle' | 'live' | 'record';
  irMode: 'off' | 'on' | 'auto';
  irEnabled: boolean;
  pan: number;
  tilt: number;
  temperatureC: number | null;
  recording: boolean;
  motionDetected: boolean;
  updatedAt: string;
}

const PREVIEW_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

type CommandAction = 'panLeft' | 'panRight' | 'tiltUp' | 'tiltDown' | 'irOn' | 'irOff' | 'recordStart' | 'recordStop';

const formatRecordingDuration = (startIso: string | null): string => {
  if (!startIso) {
    return '00:00:00';
  }

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
  const previewStartingRef = useRef<boolean>(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnimationFrameRef = useRef<number | null>(null);

  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingState, setLoadingState] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<null | CommandAction>(null);
  const [previewStarting, setPreviewStarting] = useState<boolean>(false);
  const [previewActive, setPreviewActive] = useState<boolean>(false);
  const [previewStatusKey, setPreviewStatusKey] = useState<string>('cameras.previewIdle');
  const [previewErrorKey, setPreviewErrorKey] = useState<string | null>(null);

  const [cameras, setCameras] = useState<CameraListItem[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [lastCommandResult, setLastCommandResult] = useState<{
    commandId: string;
    action: string;
    result: 'accepted' | 'rejected' | 'executed' | 'failed';
    reasonCode?: string;
  } | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(42);
  const [outputAudioEnabled, setOutputAudioEnabled] = useState<boolean>(true);
  const [uplinkMicEnabled, setUplinkMicEnabled] = useState<boolean>(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [recordingDurationLabel, setRecordingDurationLabel] = useState<string>('00:00:00');

  const forcedCameraId = params?.id ?? params?.cameraId ?? params?.cameraid ?? searchParams?.cameraId ?? searchParams?.id ?? null;

  const clearPreviewVideoElement = useCallback(() => {
    if (!previewVideoRef.current) {
      return;
    }

    previewVideoRef.current.srcObject = null;
  }, []);

  const stopPreviewStream = useCallback(() => {
    if (!previewStreamRef.current) {
      return;
    }

    for (const track of previewStreamRef.current.getTracks()) {
      track.stop();
    }

    previewStreamRef.current = null;
  }, []);

  const stopPreviewConnection = useCallback(() => {
    if (!previewPeerRef.current) {
      return;
    }

    previewPeerRef.current.ontrack = null;
    previewPeerRef.current.onconnectionstatechange = null;
    previewPeerRef.current.close();
    previewPeerRef.current = null;
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
    if (peerConnection.iceGatheringState === 'complete') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const handleGatheringChange = () => {
        if (peerConnection.iceGatheringState !== 'complete') {
          return;
        }

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
    if (!selectedCameraId) {
      return null;
    }

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
      setSelectedCameraId((previous) => {
        if (forcedCameraId && response.cameras.some((camera) => camera.id === forcedCameraId)) {
          return forcedCameraId;
        }

        if (previous && response.cameras.some((camera) => camera.id === previous)) {
          return previous;
        }

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

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  useEffect(() => {
    if (!forcedCameraId) {
      return;
    }

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
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  useEffect(() => {
    if (!selectedCameraId) {
      return;
    }

    const roomCode = `camera-${selectedCameraId}`;
    void joinRoom(roomCode);

    return () => {
      void leaveRoom(roomCode);
    };
  }, [selectedCameraId]);

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

        if (selectedCameraId !== serverOutput.cameraId) {
          return;
        }

        setCameraState((previous) => {
          if (!previous) {
            return previous;
          }

          return {
            ...previous,
            ...(typeof serverOutput.patch.isOnline === 'boolean' ? { isOnline: serverOutput.patch.isOnline } : {}),
            ...(serverOutput.patch.mode === undefined ? {} : { mode: serverOutput.patch.mode }),
            ...(serverOutput.patch.irMode === undefined ? {} : { irMode: serverOutput.patch.irMode }),
            ...(serverOutput.patch.irEnabled === undefined ? {} : { irEnabled: serverOutput.patch.irEnabled }),
            ...(serverOutput.patch.pan === undefined ? {} : { pan: serverOutput.patch.pan }),
            ...(serverOutput.patch.tilt === undefined ? {} : { tilt: serverOutput.patch.tilt }),
            ...(serverOutput.patch.temperatureC === undefined ? {} : { temperatureC: serverOutput.patch.temperatureC }),
            ...(serverOutput.patch.motionDetected === undefined ? {} : { motionDetected: serverOutput.patch.motionDetected }),
            ...(serverOutput.patch.recording === undefined ? {} : { recording: serverOutput.patch.recording }),
            updatedAt: serverOutput.at,
          };
        });
      },
    });

    const unsubscribeCommand = upsertSyncEventCallback({
      name: 'cameras/cameraCommandResult',
      version: 'v1',
      callback: ({ serverOutput }) => {
        if (selectedCameraId !== serverOutput.cameraId) {
          return;
        }

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
        if (!session?.id || session.id !== serverOutput.userId) {
          return;
        }

        notify.error({ key: serverOutput.reasonCode || 'camera.accessDenied' });

        if (selectedCameraId === serverOutput.cameraId) {
          stopPreview();
          setSelectedCameraId(null);
          setCameraState(null);
        }
      },
    });

    return () => {
      unsubscribeState();
      unsubscribeCommand();
      unsubscribeForcedLeave();
    };
  }, [selectedCameraId, session?.id, stopPreview, upsertSyncEventCallback]);

  const sendCommand = useCallback(async (action: CommandAction) => {
    if (!selectedCameraId) {
      return;
    }

    setBusyAction(action);
    const response = await apiRequest({
      name: 'cameras/executeCameraCommand',
      version: 'v1',
      data: {
        cameraId: selectedCameraId,
        commandId: globalThis.crypto.randomUUID(),
        action,
      },
    });

    setBusyAction(null);

    if (response.status === 'success') {
      setLastCommandResult({
        commandId: response.command.commandId,
        action: response.command.action,
        result: response.command.status,
      });
      return;
    }

    notify.error({
      key: response.errorCode,
      ...('errorParams' in response ? { params: response.errorParams } : {}),
    });
  }, [selectedCameraId]);

  const setIRMode = useCallback(async (irMode: 'off' | 'on' | 'auto') => {
    if (!selectedCameraId) {
      return;
    }

    setBusyAction(irMode === 'on' ? 'irOn' : 'irOff');

    const response = await apiRequest({
      name: 'cameras/setIRMode',
      version: 'v1',
      data: {
        cameraId: selectedCameraId,
        irMode,
      },
    });

    setBusyAction(null);

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
    }
  }, [selectedCameraId]);

  const setRecording = useCallback(async (recording: boolean) => {
    if (!selectedCameraId) {
      return;
    }

    setBusyAction(recording ? 'recordStart' : 'recordStop');

    const response = await apiRequest({
      name: 'cameras/setRecordingMode',
      version: 'v1',
      data: {
        cameraId: selectedCameraId,
        recording,
      },
    });

    setBusyAction(null);

    if (response.status === 'error') {
      notify.error({ key: response.errorCode });
    }
  }, [selectedCameraId]);

  const startPreview = useCallback(async () => {
    if (!selectedCameraId) {
      return;
    }

    if (!('RTCPeerConnection' in globalThis)) {
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('cameras.previewUnsupported');
      notify.error({ key: 'cameras.previewUnsupported' });
      return;
    }

    // Ref guard: the effect that calls startPreview can re-fire before
    // setPreviewStarting(true) commits, so without this we'd tear down and
    // re-create the PeerConnection multiple times and the answer would land
    // on a stale closed PC. Must be set AFTER stopPreview() because stopPreview
    // resets the same ref.
    if (previewStartingRef.current) {
      return;
    }

    stopPreview();
    previewStartingRef.current = true;
    setPreviewStarting(true);
    setPreviewStatusKey('cameras.previewConnecting');
    setPreviewErrorKey(null);

    const [peerCreateError, peerConnection] = await tryCatch(() => {
      return new RTCPeerConnection({ iceServers: PREVIEW_ICE_SERVERS });
    });

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

    peerConnection.ontrack = (event) => {
      const firstStream = event.streams[0];
      previewStreamRef.current = firstStream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = firstStream;
        previewVideoRef.current.muted = !outputAudioEnabled;
      }

      setPreviewActive(true);
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewConnected');
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'closed') {
        stopPreview();
      }
    };

    const [offerCreateError, offer] = await tryCatch(async () => {
      return peerConnection.createOffer();
    });

    if (offerCreateError || !offer) {
      previewStartingRef.current = false;
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      stopPreview();
      return;
    }

    const [localDescriptionError] = await tryCatch(async () => {
      return peerConnection.setLocalDescription(offer);
    });

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
      data: {
        cameraId: selectedCameraId,
        offerSdp,
      },
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

    const [remoteDescriptionError] = await tryCatch(async () => {
      return peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: offerResponse.answerSdp,
      });
    });

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
      await tryCatch(async () => {
        return peerConnection.addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        });
      });
    }

    previewStartingRef.current = false;
      setPreviewStarting(false);
    setPreviewActive(true);
    setPreviewStatusKey('cameras.previewConnected');
  }, [outputAudioEnabled, selectedCameraId, stopPreview, waitForIceGathering]);

  useEffect(() => {
    if (!selectedCameraId || !selectedCamera?.canPreview) {
      return;
    }

    if (previewActive || previewStarting) {
      return;
    }

    void startPreview();
  }, [selectedCameraId, selectedCamera?.canPreview, previewActive, previewStarting, startPreview]);

  useEffect(() => {
    if (!cameraState?.recording) {
      setRecordingStartedAt(null);
      setRecordingDurationLabel('00:00:00');
      return;
    }

    if (!recordingStartedAt) {
      setRecordingStartedAt(cameraState.updatedAt);
      setRecordingDurationLabel(formatRecordingDuration(cameraState.updatedAt));
    }

    const interval = globalThis.setInterval(() => {
      setRecordingDurationLabel(formatRecordingDuration(recordingStartedAt ?? cameraState.updatedAt));
    }, 1000);

    return () => {
      globalThis.clearInterval(interval);
    };
  }, [cameraState?.recording, cameraState?.updatedAt, recordingStartedAt]);

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
    };

    if (!uplinkMicEnabled) {
      stopMicCapture();
      return;
    }

    let cancelled = false;

    const startMicCapture = async () => {
      const [streamError, stream] = await tryCatch(async () => {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      });

      if (streamError || !stream) {
        setUplinkMicEnabled(false);
        notify.error({ key: 'camera.unexpectedError' });
        return;
      }

      if (cancelled) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      micStreamRef.current = stream;
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
        for (let index = 0; index < dataArray.length; index += 1) {
          const normalized = (dataArray[index] - 128) / 128;
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
  }, [uplinkMicEnabled]);

  useEffect(() => {
    if (!previewVideoRef.current) {
      return;
    }

    previewVideoRef.current.muted = !outputAudioEnabled;
  }, [outputAudioEnabled, previewActive]);

  const controlsDisabled = busyAction !== null || !selectedCamera?.canControl;

  const qualityLabel = useMemo(() => {
    if (!selectedCamera) {
      return '4K';
    }

    if (!previewActive) {
      return 'STBY';
    }

    if (cameraState?.mode === 'record') {
      return '4K';
    }

    if (cameraState?.mode === 'live') {
      return '1080P';
    }

    return '4K';
  }, [cameraState?.mode, previewActive, selectedCamera]);

  const fpsLabel = previewActive ? '45FPS' : '0FPS';
  const zoomLabel = `${(1 + (zoomLevel / 30)).toFixed(1)}X`;
  const recordingActive = Boolean(cameraState?.recording);
  const currentIRMode = cameraState?.irMode ?? selectedCamera?.irMode ?? 'auto';

  const previewActionLabel = useMemo(() => {
    if (previewActive || previewStarting) {
      return translate({ key: 'cameras.stopPreview' });
    }

    return translate({ key: 'cameras.startPreview' });
  }, [previewActive, previewStarting, translate]);

  const temperatureLabel = useMemo(() => {
    if (cameraState?.temperatureC === null || cameraState?.temperatureC === undefined) {
      return translate({ key: 'cameras.notAvailable' });
    }

    return `${String(cameraState.temperatureC.toFixed(1))} C`;
  }, [cameraState?.temperatureC, translate]);

  const handlePreviewAction = useCallback(() => {
    if (previewActive || previewStarting) {
      stopPreview();
      return;
    }

    void startPreview();
  }, [previewActive, previewStarting, startPreview, stopPreview]);

  const renderPtzPad = useCallback((sizeClassName: string) => {
    return (
      <div className={`relative ${sizeClassName} rounded-full border border-container2-border bg-container2 p-6`}>
        <button
          className={`absolute left-1/2 top-4 h-11 w-11 -translate-x-1/2 rounded-full border border-container1-border bg-container1 shadow-sm transition-colors hover:border-primary/35 disabled:opacity-60`}
          disabled={controlsDisabled}
          onClick={() => {
            void sendCommand('tiltUp');
          }}
          type="button"
        >
          <div className={`flex h-full w-full items-center justify-center`}>
            <Icon name="keyboard_arrow_up" size="24px" customClasses="text-common" />
          </div>
        </button>

        <button
          className={`absolute bottom-4 left-1/2 h-11 w-11 -translate-x-1/2 rounded-full border border-container1-border bg-container1 shadow-sm transition-colors hover:border-primary/35 disabled:opacity-60`}
          disabled={controlsDisabled}
          onClick={() => {
            void sendCommand('tiltDown');
          }}
          type="button"
        >
          <div className={`flex h-full w-full items-center justify-center`}>
            <Icon name="keyboard_arrow_down" size="24px" customClasses="text-common" />
          </div>
        </button>

        <button
          className={`absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full border border-container1-border bg-container1 shadow-sm transition-colors hover:border-primary/35 disabled:opacity-60`}
          disabled={controlsDisabled}
          onClick={() => {
            void sendCommand('panLeft');
          }}
          type="button"
        >
          <div className={`flex h-full w-full items-center justify-center`}>
            <Icon name="keyboard_arrow_left" size="24px" customClasses="text-common" />
          </div>
        </button>

        <button
          className={`absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full border border-container1-border bg-container1 shadow-sm transition-colors hover:border-primary/35 disabled:opacity-60`}
          disabled={controlsDisabled}
          onClick={() => {
            void sendCommand('panRight');
          }}
          type="button"
        >
          <div className={`flex h-full w-full items-center justify-center`}>
            <Icon name="keyboard_arrow_right" size="24px" customClasses="text-common" />
          </div>
        </button>

        <button
          className={`absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/30 bg-primary/10`}
          onClick={() => {
            if (selectedCamera) {
              void loadCameraState(selectedCamera.id);
            }
          }}
          type="button"
        >
          <Icon name="home" size="22px" customClasses="text-primary" />
        </button>
      </div>
    );
  }, [controlsDisabled, loadCameraState, selectedCamera, sendCommand]);

  const renderPreviewPanel = useCallback((desktop: boolean) => {
    return (
      <div className={`relative w-full overflow-hidden rounded-2xl border border-container2-border bg-container2 ${desktop ? 'h-full min-h-[30rem]' : 'aspect-video'}`}>
        {!previewActive && (
          <div className={`absolute inset-0 z-20 flex items-center justify-center bg-container2/80 px-4 text-center text-sm font-semibold text-common`}>
            {translate({ key: 'cameras.previewNoSignal' })}
          </div>
        )}

        <video
          autoPlay
          className={`h-full w-full object-cover ${previewActive ? 'block' : 'hidden'}`}
          controls
          muted={!outputAudioEnabled}
          playsInline
          ref={previewVideoRef}
        />

        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-title/70 via-transparent to-title/50`} />

        <div className={`absolute left-3 right-3 top-3 z-30 flex items-start justify-between gap-2`}>
          <div className={`min-w-0 flex-1`}>
            <div className={`inline-flex max-w-full items-center gap-2 rounded-full border border-title-primary/20 bg-title/65 px-3 py-1 text-xs font-bold uppercase tracking-wide text-title-primary`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${recordingActive ? 'bg-wrong animate-pulse' : 'bg-correct'}`} />
              <span className={`truncate`}>{selectedCamera?.name}</span>
            </div>

            <div className={`mt-2 inline-flex items-center gap-2 rounded-md border border-title-primary/20 bg-title/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-title-primary`}>
              <span>{qualityLabel}</span>
              <span>/</span>
              <span>{fpsLabel}</span>
            </div>
          </div>

          <div className={`flex flex-col items-end gap-2`}>
            <div className={`rounded-full border border-title-primary/20 bg-title/65 px-3 py-1 text-xs font-bold text-title-primary`}>
              {translate({ key: 'cameras.temperature' })}: {temperatureLabel}
            </div>
            <div className={`rounded-full border px-3 py-1 text-xs font-bold ${recordingActive ? 'border-wrong/40 bg-wrong/15 text-title-primary' : 'border-container2-border bg-container2/80 text-common'}`}>
              {recordingActive
                ? `${translate({ key: 'cameras.recording' })} ${recordingDurationLabel}`
                : translate({ key: 'dashboard.recordingPaused' })}
            </div>
          </div>
        </div>

        <div className={`absolute bottom-3 left-3 right-3 z-30 flex items-center justify-between gap-2`}>
          <div className={`rounded-full border border-title-primary/20 bg-title/65 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-title-primary`}>
            {translate({ key: 'cameraDesign.previewStatus' })}: {translate({ key: previewStatusKey })}
          </div>

          <button
            className={`rounded-full border border-primary-border bg-primary px-3 py-1 text-xs font-bold text-title-primary disabled:opacity-60`}
            disabled={!selectedCamera?.canPreview || previewStarting}
            onClick={handlePreviewAction}
            type="button"
          >
            {previewActionLabel}
          </button>
        </div>
      </div>
    );
  }, [fpsLabel, handlePreviewAction, outputAudioEnabled, previewActionLabel, previewActive, previewStarting, previewStatusKey, qualityLabel, recordingActive, recordingDurationLabel, selectedCamera?.canPreview, selectedCamera?.name, temperatureLabel, translate]);

  if (!selectedCamera && !loadingList) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-background p-4`}>
        <div className={`rounded-xl border border-container1-border bg-container1 p-4 text-common`}>
          {translate({ key: 'cameras.selectPrompt' })}
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full w-full overflow-y-auto bg-background`}>
      <div className={`mx-auto flex w-full max-w-[96rem] flex-col gap-5 px-4 py-4 md:px-6 md:py-6 [container-type:inline-size]`}>
        <div className={`rounded-2xl border border-container2-border bg-container1 p-4 md:p-5`}> 
          <div className={`flex flex-wrap items-center justify-between gap-3`}>
            <div className={`flex min-w-0 items-center gap-2`}>
              <Icon name="videocam" size="22px" customClasses="text-primary" />
              <div className={`truncate text-2xl font-black tracking-tight text-title`}>{translate({ key: 'cameraDesign.monitorTitle' })}</div>
            </div>

            <div className={`flex items-center gap-2`}>
              <button
                className={`rounded-lg border border-container2-border bg-container2 px-3 py-2 text-xs font-bold text-title`}
                onClick={() => {
                  void loadCameras();
                }}
                type="button"
              >
                {translate({ key: 'cameras.refresh' })}
              </button>

              <button
                className={`rounded-lg border border-container2-border bg-container2 px-3 py-2 text-xs font-bold text-title disabled:opacity-60`}
                disabled={loadingState || !selectedCamera}
                onClick={() => {
                  if (selectedCamera) {
                    void loadCameraState(selectedCamera.id);
                  }
                }}
                type="button"
              >
                {translate({ key: 'cameras.refreshState' })}
              </button>
            </div>
          </div>

          <div className={`mt-3 flex gap-2 overflow-x-auto pb-1`}>
            {cameras.map((camera) => {
              const selected = camera.id === selectedCameraId;
              const offline = !camera.isOnline || camera.mode === 'off';

              return (
                <button
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${selected ? 'border-primary-border bg-primary text-title-primary' : 'border-container2-border bg-container2 text-title'} ${offline ? 'opacity-80' : ''}`}
                  key={camera.id}
                  onClick={() => {
                    setSelectedCameraId(camera.id);
                  }}
                  type="button"
                >
                  <div className={`flex items-center gap-2`}>
                    <span className={`h-2 w-2 rounded-full ${offline ? 'bg-wrong' : 'bg-correct'}`} />
                    <span>{camera.name}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {!selectedCamera?.canControl && !loadingList && (
            <div className={`mt-3 rounded-lg border border-wrong/30 bg-wrong/10 px-3 py-2 text-xs font-medium text-wrong`}>
              {translate({ key: 'cameras.controlDisabledHint' })}
            </div>
          )}

          {loadingState && (
            <div className={`mt-3 animate-pulse rounded-lg border border-container2-border bg-container2 px-3 py-2 text-xs text-common`}>
              {translate({ key: 'cameras.loadingState' })}
            </div>
          )}
        </div>

        {loadingList && (
          <div className={`animate-pulse rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
            {translate({ key: 'cameras.loading' })}
          </div>
        )}

        {!loadingList && !selectedCamera && (
          <div className={`rounded-xl border border-container2-border bg-container1 p-4 text-sm text-common`}>
            {translate({ key: 'cameras.empty' })}
          </div>
        )}

        {!loadingList && selectedCamera && (
          <>
            <div className={`md:hidden`}>
              <div className={`flex flex-col gap-4`}>
                {renderPreviewPanel(false)}

                <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2`}>
                  <button
                    className={`rounded-xl border px-4 py-2 text-xs font-bold ${(previewActive || previewStarting) ? 'border-container2-border bg-container2 text-title' : 'border-primary-border bg-primary text-title-primary'} disabled:opacity-60`}
                    disabled={!selectedCamera.canPreview}
                    onClick={handlePreviewAction}
                    type="button"
                  >
                    {previewActionLabel}
                  </button>

                  <button
                    className={`rounded-xl border px-4 py-2 text-xs font-bold ${recordingActive ? 'border-wrong/35 bg-wrong/15 text-wrong' : 'border-container2-border bg-container2 text-title'} disabled:opacity-60`}
                    disabled={controlsDisabled}
                    onClick={() => {
                      void setRecording(!recordingActive);
                    }}
                    type="button"
                  >
                    {recordingActive
                      ? translate({ key: 'cameras.recordStop' })
                      : translate({ key: 'cameras.recordStart' })}
                  </button>
                </div>

                {previewErrorKey && (
                  <div className={`rounded-lg border border-wrong/30 bg-wrong/10 px-3 py-2 text-xs font-semibold text-wrong`}>
                    {translate({ key: previewErrorKey })}
                  </div>
                )}

                <div className={`rounded-2xl border border-container2-border bg-container1 p-4`}> 
                  <div className={`mb-3 text-xs font-bold uppercase tracking-widest text-common/70`}>
                    {translate({ key: 'cameraDesign.precisionPtz' })}
                  </div>
                  <div className={`flex justify-center`}>{renderPtzPad('h-56 w-56')}</div>

                  <div className={`mt-4 flex items-center justify-between gap-2`}>
                    <div className={`text-xs font-bold uppercase tracking-widest text-common/70`}>
                      {translate({ key: 'cameraDesign.opticalZoom' })}
                    </div>
                    <div className={`text-sm font-bold text-primary`}>{zoomLabel}</div>
                  </div>

                  <div className={`mt-3 flex items-center gap-2 rounded-xl border border-container2-border bg-container2 p-3`}>
                    <Icon name="zoom_out" size="18px" customClasses="text-common" />
                    <input
                      className={`w-full accent-primary`}
                      max={100}
                      min={1}
                      onChange={(event) => {
                        setZoomLevel(Number(event.target.value));
                      }}
                      type="range"
                      value={zoomLevel}
                    />
                    <Icon name="zoom_in" size="18px" customClasses="text-common" />
                  </div>
                </div>

                <div className={`rounded-2xl border border-container2-border bg-container1 p-4`}> 
                  <div className={`mb-3 text-xs font-bold uppercase tracking-widest text-common/70`}>
                    {translate({ key: 'cameraDesign.infraredMode' })}
                  </div>
                  <div className={`grid grid-cols-3 gap-2`}>
                    {[
                      { mode: 'off' as const, key: 'cameras.irOff' },
                      { mode: 'on' as const, key: 'cameras.irOn' },
                      { mode: 'auto' as const, key: 'cameras.auto' },
                    ].map((item) => {
                      const active = currentIRMode === item.mode;

                      return (
                        <button
                          className={`rounded-lg border px-2 py-2 text-xs font-bold ${active ? 'border-primary-border bg-primary text-title-primary' : 'border-container2-border bg-container2 text-title'} disabled:opacity-60`}
                          disabled={controlsDisabled}
                          key={item.mode}
                          onClick={() => {
                            void setIRMode(item.mode);
                          }}
                          type="button"
                        >
                          {translate({ key: item.key })}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2`}>
                  <div className={`rounded-2xl border border-container2-border bg-container1 p-4`}>
                    <div className={`mb-3 text-xs font-bold uppercase tracking-widest text-common/70`}>
                      {translate({ key: 'cameraDesign.systemAudio' })}
                    </div>
                    <button
                      className={`w-full rounded-xl border px-3 py-3 text-xs font-bold ${outputAudioEnabled ? 'border-primary-border bg-primary text-title-primary' : 'border-container2-border bg-container2 text-title'}`}
                      onClick={() => {
                        setOutputAudioEnabled((previous) => !previous);
                      }}
                      type="button"
                    >
                      <div className={`flex items-center justify-center gap-2`}>
                        <Icon name={outputAudioEnabled ? 'volume_up' : 'volume_off'} size="18px" customClasses={outputAudioEnabled ? 'text-title-primary' : 'text-common'} />
                        <span>
                          {outputAudioEnabled
                            ? translate({ key: 'cameraDesign.audioActive' })
                            : translate({ key: 'cameraDesign.audioMuted' })}
                        </span>
                      </div>
                    </button>
                  </div>

                  <div className={`rounded-2xl border border-container2-border bg-container1 p-4`}>
                    <div className={`mb-3 flex items-center justify-between gap-2`}>
                      <div className={`text-xs font-bold uppercase tracking-widest text-common/70`}>
                        {translate({ key: 'cameraDesign.commUplink' })}
                      </div>
                      <div className={`text-[10px] font-bold uppercase tracking-wide text-primary`}>
                        {translate({ key: 'cameraDesign.stationActive' })}
                      </div>
                    </div>

                    <div className={`flex items-center gap-3`}>
                      <button
                        className={`h-12 w-12 shrink-0 rounded-full border ${uplinkMicEnabled ? 'border-primary-border bg-primary/10' : 'border-container2-border bg-container2'}`}
                        onClick={() => {
                          setUplinkMicEnabled((previous) => !previous);
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name={uplinkMicEnabled ? 'mic' : 'mic_off'} size="22px" customClasses={uplinkMicEnabled ? 'text-primary' : 'text-common'} />
                        </div>
                      </button>

                      <div className={`flex-1`}>
                        <div className={`mb-2 flex h-8 items-end gap-1 rounded-md border border-container2-border bg-container2 px-2`}>
                          {Array.from({ length: 12 }).map((_, index) => {
                            const threshold = ((index + 1) / 12) * 100;
                            const active = micLevel >= threshold;

                            return (
                              <div
                                className={`w-1 rounded-sm ${active ? 'bg-primary' : 'bg-container1-border'}`}
                                key={`mobile-mic-bar-${String(index)}`}
                                style={{ height: `${String(((index % 5) + 2) * 14)}%` }}
                              />
                            );
                          })}
                        </div>

                        <div className={`h-2 w-full overflow-hidden rounded-full border border-container2-border bg-container2`}>
                          <div className={`h-full bg-primary transition-all duration-100`} style={{ width: `${String(micLevel)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {lastCommandResult && (
                  <div className={`rounded-xl border border-container2-border bg-container1 p-3 text-xs text-common`}>
                    <div className={`font-semibold text-title`}>{translate({ key: 'cameras.lastCommand' })}</div>
                    <div>{translate({ key: 'cameras.action' })}: {lastCommandResult.action}</div>
                    <div>{translate({ key: 'cameras.result' })}: {lastCommandResult.result}</div>
                  </div>
                )}
              </div>
            </div>

            <div className={`hidden md:block`}>
              <div className={`grid grid-cols-[minmax(0,4fr)_minmax(18rem,1fr)] gap-4 items-start`}>
                <div className={`rounded-3xl border border-container2-border bg-container1 p-4 flex flex-col gap-3 min-h-[34rem]`}>
                  {renderPreviewPanel(true)}

                  <div className={`grid grid-cols-2 gap-2`}>
                    <button
                      className={`rounded-xl border px-4 py-2 text-xs font-bold ${(previewActive || previewStarting) ? 'border-container2-border bg-container2 text-title' : 'border-primary-border bg-primary text-title-primary'} disabled:opacity-60`}
                      disabled={!selectedCamera.canPreview}
                      onClick={handlePreviewAction}
                      type="button"
                    >
                      {previewActionLabel}
                    </button>

                    <button
                      className={`rounded-xl border px-4 py-2 text-xs font-bold ${recordingActive ? 'border-wrong/35 bg-wrong/15 text-wrong' : 'border-container2-border bg-container2 text-title'} disabled:opacity-60`}
                      disabled={controlsDisabled}
                      onClick={() => {
                        void setRecording(!recordingActive);
                      }}
                      type="button"
                    >
                      {recordingActive
                        ? translate({ key: 'cameras.recordStop' })
                        : translate({ key: 'cameras.recordStart' })}
                    </button>
                  </div>

                  {previewErrorKey && (
                    <div className={`rounded-lg border border-wrong/30 bg-wrong/10 px-3 py-2 text-xs font-semibold text-wrong`}>
                      {translate({ key: previewErrorKey })}
                    </div>
                  )}
                </div>

                <div className={`max-h-[calc(100vh-11rem)] overflow-y-auto rounded-3xl border border-container2-border bg-container1 p-3 flex flex-col gap-3`}>
                  <div className={`rounded-xl border border-container2-border bg-container2 p-2.5`}>
                    <div className={`mb-2 text-[11px] font-bold uppercase tracking-widest text-common/70`}>
                      {translate({ key: 'cameraDesign.precisionPtz' })}
                    </div>

                    <div className={`grid grid-cols-3 gap-1.5`}>
                      <div />
                      <button
                        className={`h-9 rounded-md border border-container2-border bg-container1 text-common transition-colors hover:border-primary/35 disabled:opacity-60`}
                        disabled={controlsDisabled}
                        onClick={() => {
                          void sendCommand('tiltUp');
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name="keyboard_arrow_up" size="20px" customClasses="text-common" />
                        </div>
                      </button>
                      <div />

                      <button
                        className={`h-9 rounded-md border border-container2-border bg-container1 text-common transition-colors hover:border-primary/35 disabled:opacity-60`}
                        disabled={controlsDisabled}
                        onClick={() => {
                          void sendCommand('panLeft');
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name="keyboard_arrow_left" size="20px" customClasses="text-common" />
                        </div>
                      </button>

                      <button
                        className={`h-9 rounded-md border border-primary/30 bg-primary/10 text-common transition-colors hover:border-primary/50`}
                        onClick={() => {
                          if (selectedCamera) {
                            void loadCameraState(selectedCamera.id);
                          }
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name="home" size="18px" customClasses="text-primary" />
                        </div>
                      </button>

                      <button
                        className={`h-9 rounded-md border border-container2-border bg-container1 text-common transition-colors hover:border-primary/35 disabled:opacity-60`}
                        disabled={controlsDisabled}
                        onClick={() => {
                          void sendCommand('panRight');
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name="keyboard_arrow_right" size="20px" customClasses="text-common" />
                        </div>
                      </button>

                      <div />
                      <button
                        className={`h-9 rounded-md border border-container2-border bg-container1 text-common transition-colors hover:border-primary/35 disabled:opacity-60`}
                        disabled={controlsDisabled}
                        onClick={() => {
                          void sendCommand('tiltDown');
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name="keyboard_arrow_down" size="20px" customClasses="text-common" />
                        </div>
                      </button>
                      <div />
                    </div>
                  </div>

                  <div className={`rounded-xl border border-container2-border bg-container2 p-2.5`}>
                    <div className={`mb-1.5 flex items-center justify-between gap-2`}>
                      <div className={`text-[11px] font-bold uppercase tracking-widest text-common/70`}>
                        {translate({ key: 'cameraDesign.opticalZoom' })}
                      </div>
                      <div className={`text-xs font-bold text-primary`}>{zoomLabel}</div>
                    </div>

                    <div className={`mx-auto flex max-w-44 items-center gap-1.5`}>
                      <Icon name="zoom_out" size="16px" customClasses="text-common" />
                      <input
                        className={`w-40 accent-primary`}
                        max={100}
                        min={1}
                        onChange={(event) => {
                          setZoomLevel(Number(event.target.value));
                        }}
                        type="range"
                        value={zoomLevel}
                      />
                      <Icon name="zoom_in" size="16px" customClasses="text-common" />
                    </div>
                  </div>

                  <div className={`rounded-xl border border-container2-border bg-container2 p-2.5`}>
                    <div className={`mb-1.5 text-[11px] font-bold uppercase tracking-widest text-common/70`}>
                      {translate({ key: 'cameraDesign.infraredMode' })}
                    </div>
                    <div className={`grid grid-cols-3 gap-1.5`}>
                      {[
                        { mode: 'off' as const, key: 'cameras.irOff' },
                        { mode: 'on' as const, key: 'cameras.irOn' },
                        { mode: 'auto' as const, key: 'cameras.auto' },
                      ].map((item) => {
                        const active = currentIRMode === item.mode;

                        return (
                          <button
                            className={`rounded-md border px-1.5 py-1.5 text-[11px] font-bold ${active ? 'border-primary-border bg-primary text-title-primary' : 'border-container2-border bg-container1 text-title'} disabled:opacity-60`}
                            disabled={controlsDisabled}
                            key={`desktop-${item.mode}`}
                            onClick={() => {
                              void setIRMode(item.mode);
                            }}
                            type="button"
                          >
                            {translate({ key: item.key })}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    className={`rounded-xl border px-3 py-2 text-xs font-bold ${outputAudioEnabled ? 'border-primary-border bg-primary text-title-primary' : 'border-container2-border bg-container2 text-title'}`}
                    onClick={() => {
                      setOutputAudioEnabled((previous) => !previous);
                    }}
                    type="button"
                  >
                    <div className={`flex items-center justify-center gap-2`}>
                      <Icon name={outputAudioEnabled ? 'volume_up' : 'volume_off'} size="16px" customClasses={outputAudioEnabled ? 'text-title-primary' : 'text-common'} />
                      <span>{translate({ key: 'cameraDesign.systemAudio' })}</span>
                    </div>
                  </button>

                  <div className={`rounded-xl border border-container2-border bg-container2 p-2.5`}>
                    <div className={`mb-2 flex items-center justify-between gap-2`}>
                      <div className={`text-[11px] font-bold uppercase tracking-widest text-common/70`}>
                        {translate({ key: 'cameraDesign.commUplink' })}
                      </div>
                      <button
                        className={`h-8 w-8 rounded-full border ${uplinkMicEnabled ? 'border-primary-border bg-primary/10' : 'border-container2-border bg-container1'}`}
                        onClick={() => {
                          setUplinkMicEnabled((previous) => !previous);
                        }}
                        type="button"
                      >
                        <div className={`flex h-full w-full items-center justify-center`}>
                          <Icon name={uplinkMicEnabled ? 'mic' : 'mic_off'} size="16px" customClasses={uplinkMicEnabled ? 'text-primary' : 'text-common'} />
                        </div>
                      </button>
                    </div>

                    <div className={`h-2 w-full overflow-hidden rounded-full border border-container2-border bg-container1`}>
                      <div className={`h-full bg-primary transition-all duration-100`} style={{ width: `${String(micLevel)}%` }} />
                    </div>
                  </div>

                  <button
                    className={`rounded-xl border px-3 py-2 text-xs font-bold ${recordingActive ? 'border-wrong/35 bg-wrong/15 text-wrong' : 'border-primary-border bg-primary text-title-primary'} disabled:opacity-60`}
                    disabled={controlsDisabled}
                    onClick={() => {
                      void setRecording(!recordingActive);
                    }}
                    type="button"
                  >
                    {recordingActive
                      ? translate({ key: 'cameras.recordStop' })
                      : translate({ key: 'cameras.recordStart' })}
                  </button>

                  <div className={`rounded-xl border border-container2-border bg-container2 p-2.5 text-[11px] text-common`}>
                    <div className={`font-semibold text-title`}>{translate({ key: 'cameras.lastCommand' })}</div>
                    {!lastCommandResult && (
                      <div>{translate({ key: 'cameras.noCommandYet' })}</div>
                    )}
                    {lastCommandResult && (
                      <>
                        <div>{translate({ key: 'cameras.action' })}: {lastCommandResult.action}</div>
                        <div>{translate({ key: 'cameras.result' })}: {lastCommandResult.result}</div>
                        <div>{translate({ key: 'cameras.reasonCode' })}: {lastCommandResult.reasonCode ?? '-'}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
