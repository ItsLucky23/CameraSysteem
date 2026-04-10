import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import tryCatch from 'shared/tryCatch';

import notify from 'src/_functions/notify';
import { useTranslator } from 'src/_functions/translator';
import { useSession } from 'src/_providers/SessionProvider';
import { apiRequest } from 'src/_sockets/apiRequest';
import { joinRoom, leaveRoom } from 'src/_sockets/socketInitializer';
import { useSyncEvents } from 'src/_sockets/syncRequest';

export const template = 'home';

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

interface PreviewSession {
  transport: 'webrtc';
  streamKey: string;
  token: string;
  offerUrl: string;
  expiresAt: string;
  iceServers: RTCIceServer[];
}

type CommandAction = 'panLeft' | 'panRight' | 'tiltUp' | 'tiltDown' | 'irOn' | 'irOff' | 'recordStart' | 'recordStop';

export default function CamerasPage() {
  const translate = useTranslator();
  const { session } = useSession();
  const { upsertSyncEventCallback } = useSyncEvents();

  const previewPeerRef = useRef<RTCPeerConnection | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

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
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [lastCommandResult, setLastCommandResult] = useState<{
    commandId: string;
    action: string;
    result: 'accepted' | 'rejected' | 'executed' | 'failed';
    reasonCode?: string;
  } | null>(null);

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
  }, []);

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
    if (!selectedCameraId) {
      stopPreview();
      setCameraState(null);
      setPreviewSession(null);
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
          setPreviewSession(null);
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

  const createPreviewSession = useCallback(async () => {
    if (!selectedCameraId) {
      return;
    }

    stopPreview();
    setPreviewErrorKey(null);
    setPreviewStatusKey('cameras.previewPreparing');

    const response = await apiRequest({
      name: 'cameras/getCameraPreviewSession',
      version: 'v1',
      data: {
        cameraId: selectedCameraId,
      },
    });

    if (response.status === 'success') {
      setPreviewSession({
        transport: response.transport,
        streamKey: response.streamKey,
        token: response.signaling.token,
        offerUrl: response.signaling.offerUrl,
        expiresAt: response.signaling.expiresAt,
        iceServers: response.signaling.iceServers,
      });
      setPreviewStatusKey('cameras.previewReady');
      return;
    }

    setPreviewStatusKey('cameras.previewFailed');
    setPreviewErrorKey(response.errorCode);

    notify.error({ key: response.errorCode });
  }, [selectedCameraId, stopPreview]);

  const startPreview = useCallback(async () => {
    if (!selectedCameraId || !previewSession) {
      return;
    }

    if (!('RTCPeerConnection' in globalThis)) {
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('cameras.previewUnsupported');
      notify.error({ key: 'cameras.previewUnsupported' });
      return;
    }

    stopPreview();
    setPreviewStarting(true);
    setPreviewStatusKey('cameras.previewConnecting');
    setPreviewErrorKey(null);

    const [peerCreateError, peerConnection] = await tryCatch(() => {
      return new RTCPeerConnection({ iceServers: previewSession.iceServers });
    });

    if (peerCreateError || !peerConnection) {
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewFailed');
      setPreviewErrorKey('camera.webrtcSignalingFailed');
      notify.error({ key: 'camera.webrtcSignalingFailed' });
      return;
    }

    previewPeerRef.current = peerConnection;

    peerConnection.ontrack = (event) => {
      const firstStream = event.streams[0];
      previewStreamRef.current = firstStream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = firstStream;
      }

      setPreviewActive(true);
      setPreviewStarting(false);
      setPreviewStatusKey('cameras.previewConnected');
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'closed') {
        stopPreview();
      }
    };

    const [offerCreateError, offer] = await tryCatch(async () => {
      return peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
    });

    if (offerCreateError || !offer) {
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
        previewToken: previewSession.token,
        offerSdp,
      },
    });

    if (offerResponse.status === 'error') {
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

    setPreviewStarting(false);
    setPreviewActive(true);
    setPreviewStatusKey('cameras.previewConnected');
  }, [previewSession, selectedCameraId, stopPreview, waitForIceGathering]);

  const cameraStatusText = cameraState?.isOnline
    ? translate({ key: 'cameras.statusOnline' })
    : translate({ key: 'cameras.statusOffline' });

  const controlsDisabled = busyAction !== null || !selectedCamera?.canControl;
  const startPreviewDisabled = previewStarting || !previewSession;
  const stopPreviewDisabled = !previewActive && !previewStarting;

  return (
    <div className={`w-full h-full bg-background overflow-y-auto`}>
      <div className={`w-full max-w-7xl self-center p-4 md:p-6 flex flex-col gap-4`}>
        <div className={`w-full bg-container1 border border-container1-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-2`}>
          <div className={`flex flex-col`}>
            <div className={`text-xl font-semibold text-title`}>{translate({ key: 'cameras.title' })}</div>
            <div className={`text-sm text-common`}>{translate({ key: 'cameras.subtitle' })}</div>
          </div>
          <button
            className={`h-9 px-4 rounded-md bg-container2 border border-container2-border text-title`}
            onClick={() => {
              void loadCameras();
            }}
          >
            {translate({ key: 'cameras.refresh' })}
          </button>
        </div>

        <div className={`w-full grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4`}>
          <div className={`bg-container1 border border-container1-border rounded-xl p-3 flex flex-col gap-2 max-h-[70vh] overflow-y-auto`}>
            {loadingList && (
              <div className={`text-sm text-common`}>{translate({ key: 'cameras.loading' })}</div>
            )}
            {!loadingList && cameras.length === 0 && (
              <div className={`text-sm text-common`}>{translate({ key: 'cameras.empty' })}</div>
            )}
            {cameras.map((camera) => {
              const isSelected = selectedCameraId === camera.id;

              return (
                <button
                  key={camera.id}
                  className={`w-full rounded-lg border p-3 flex flex-col items-start gap-1 text-left ${isSelected ? 'bg-container3 border-container3-border text-title' : 'bg-container2 border-container2-border text-title'}`}
                  onClick={() => {
                    stopPreview();
                    setSelectedCameraId(camera.id);
                    setPreviewSession(null);
                    setPreviewErrorKey(null);
                    setPreviewStatusKey('cameras.previewIdle');
                  }}
                >
                  <div className={`text-sm font-semibold line-clamp-1`}>{camera.name}</div>
                  <div className={`text-xs ${isSelected ? 'text-title' : 'text-common'}`}>{camera.slug}</div>
                  <div className={`text-xs ${isSelected ? 'text-title' : 'text-common'}`}>
                    {camera.isOnline
                      ? translate({ key: 'cameras.statusOnline' })
                      : translate({ key: 'cameras.statusOffline' })}
                  </div>
                </button>
              );
            })}
          </div>

          <div className={`bg-container1 border border-container1-border rounded-xl p-4 flex flex-col gap-4`}>
            {!selectedCamera && (
              <div className={`text-sm text-common`}>{translate({ key: 'cameras.selectPrompt' })}</div>
            )}

            {selectedCamera && (
              <>
                <div className={`flex flex-wrap items-center justify-between gap-2`}>
                  <div className={`flex flex-col`}>
                    <div className={`text-lg font-semibold text-title`}>{selectedCamera.name}</div>
                    <div className={`text-xs text-common`}>{selectedCamera.id}</div>
                  </div>
                  <button
                    className={`h-9 px-4 rounded-md bg-container2 border border-container2-border text-title`}
                    onClick={() => {
                      void loadCameraState(selectedCamera.id);
                    }}
                  >
                    {translate({ key: 'cameras.refreshState' })}
                  </button>
                </div>

                {loadingState && (
                  <div className={`text-sm text-common`}>{translate({ key: 'cameras.loadingState' })}</div>
                )}

                {cameraState && (
                  <div className={`grid grid-cols-2 md:grid-cols-4 gap-2`}>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.status' })}</div>
                      <div className={`text-sm font-semibold text-title`}>{cameraStatusText}</div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.mode' })}</div>
                      <div className={`text-sm font-semibold text-title`}>{cameraState.mode}</div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.irMode' })}</div>
                      <div className={`text-sm font-semibold text-title`}>{cameraState.irMode}</div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.temperature' })}</div>
                      <div className={`text-sm font-semibold text-title`}>
                        {cameraState.temperatureC === null
                          ? translate({ key: 'cameras.notAvailable' })
                          : `${String(cameraState.temperatureC)} C`}
                      </div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.pan' })}</div>
                      <div className={`text-sm font-semibold text-title`}>{String(cameraState.pan)}</div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.tilt' })}</div>
                      <div className={`text-sm font-semibold text-title`}>{String(cameraState.tilt)}</div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.motion' })}</div>
                      <div className={`text-sm font-semibold text-title`}>
                        {cameraState.motionDetected
                          ? translate({ key: 'cameras.yes' })
                          : translate({ key: 'cameras.no' })}
                      </div>
                    </div>
                    <div className={`bg-container2 border border-container2-border rounded-lg p-2 flex flex-col`}>
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.recording' })}</div>
                      <div className={`text-sm font-semibold text-title`}>
                        {cameraState.recording
                          ? translate({ key: 'cameras.yes' })
                          : translate({ key: 'cameras.no' })}
                      </div>
                    </div>
                  </div>
                )}

                <div className={`bg-container2 border border-container2-border rounded-xl p-3 flex flex-col gap-2`}>
                  <div className={`text-sm font-semibold text-title`}>{translate({ key: 'cameras.controls' })}</div>
                  {!selectedCamera.canControl && (
                    <div className={`text-xs text-common`}>{translate({ key: 'cameras.controlDisabledHint' })}</div>
                  )}
                  <div className={`grid grid-cols-2 md:grid-cols-4 gap-2`}>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void sendCommand('panLeft'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.panLeft' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void sendCommand('panRight'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.panRight' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void sendCommand('tiltUp'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.tiltUp' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void sendCommand('tiltDown'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.tiltDown' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void setIRMode('on'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.irOn' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void setIRMode('off'); }} disabled={controlsDisabled}>{translate({ key: 'cameras.irOff' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void setRecording(true); }} disabled={controlsDisabled}>{translate({ key: 'cameras.recordStart' })}</button>
                    <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void setRecording(false); }} disabled={controlsDisabled}>{translate({ key: 'cameras.recordStop' })}</button>
                  </div>
                </div>

                <div className={`bg-container2 border border-container2-border rounded-xl p-3 flex flex-col gap-2`}>
                  <div className={`flex flex-wrap items-center justify-between gap-2`}>
                    <div className={`text-sm font-semibold text-title`}>{translate({ key: 'cameras.previewTitle' })}</div>
                    <div className={`flex flex-wrap gap-2`}>
                      <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} onClick={() => { void createPreviewSession(); }}>
                        {translate({ key: 'cameras.requestPreviewSession' })}
                      </button>
                      <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} disabled={startPreviewDisabled} onClick={() => { void startPreview(); }}>
                        {translate({ key: 'cameras.startPreview' })}
                      </button>
                      <button className={`h-9 px-3 rounded-md bg-container1 border border-container1-border text-title`} disabled={stopPreviewDisabled} onClick={stopPreview}>
                        {translate({ key: 'cameras.stopPreview' })}
                      </button>
                    </div>
                  </div>

                  <div className={`text-xs text-common`}>
                    {translate({ key: 'cameras.previewStatus' })}: {translate({ key: previewStatusKey })}
                  </div>

                  {previewErrorKey && (
                    <div className={`text-xs text-wrong`}>{translate({ key: previewErrorKey })}</div>
                  )}

                  <div className={`w-full aspect-video rounded-lg bg-container1 border border-container1-border overflow-hidden flex items-center justify-center`}>
                    {!previewActive && (
                      <div className={`text-xs text-common`}>{translate({ key: 'cameras.previewNoSignal' })}</div>
                    )}
                    { }
                    <video ref={previewVideoRef} autoPlay playsInline muted controls className={`w-full h-full object-cover ${previewActive ? 'block' : 'hidden'}`} />
                  </div>

                  {!previewSession && (
                    <div className={`text-xs text-common`}>{translate({ key: 'cameras.previewHint' })}</div>
                  )}

                  {previewSession && (
                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-2`}>
                      <div className={`bg-container1 border border-container1-border rounded-lg p-2 text-xs text-title`}>{translate({ key: 'cameras.transport' })}: {previewSession.transport}</div>
                      <div className={`bg-container1 border border-container1-border rounded-lg p-2 text-xs text-title`}>{translate({ key: 'cameras.streamKey' })}: {previewSession.streamKey}</div>
                      <div className={`bg-container1 border border-container1-border rounded-lg p-2 text-xs text-title`}>{translate({ key: 'cameras.offerUrl' })}: {previewSession.offerUrl}</div>
                      <div className={`bg-container1 border border-container1-border rounded-lg p-2 text-xs text-title`}>{translate({ key: 'cameras.expiresAt' })}: {previewSession.expiresAt}</div>
                      <div className={`bg-container1 border border-container1-border rounded-lg p-2 text-xs text-title md:col-span-2`}>{translate({ key: 'cameras.previewToken' })}: {previewSession.token}</div>
                    </div>
                  )}
                </div>

                <div className={`bg-container2 border border-container2-border rounded-xl p-3 flex flex-col gap-1`}>
                  <div className={`text-sm font-semibold text-title`}>{translate({ key: 'cameras.lastCommand' })}</div>
                  {!lastCommandResult && (
                    <div className={`text-xs text-common`}>{translate({ key: 'cameras.noCommandYet' })}</div>
                  )}
                  {lastCommandResult && (
                    <>
                      <div className={`text-xs text-title`}>{translate({ key: 'cameras.commandId' })}: {lastCommandResult.commandId}</div>
                      <div className={`text-xs text-title`}>{translate({ key: 'cameras.action' })}: {lastCommandResult.action}</div>
                      <div className={`text-xs text-title`}>{translate({ key: 'cameras.result' })}: {lastCommandResult.result}</div>
                      <div className={`text-xs text-title`}>{translate({ key: 'cameras.reasonCode' })}: {lastCommandResult.reasonCode ?? '-'}</div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
