import { createSocket, Socket } from 'node:dgram';

import { MediaStreamTrack, RTCPeerConnection, RtpPacket, useH264 } from 'werift';

import { tryCatch } from '../functions/tryCatch';

interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
}

const MAX_ICE_WAIT_MS = 2000;

interface ForwardPeer {
  peerConnection: RTCPeerConnection;
  track: MediaStreamTrack;
}

interface CameraIngest {
  cameraId: string;
  rtpPort: number;
  socket: Socket;
  peers: Set<ForwardPeer>;
}

// Hoisted onto globalThis so that ESM-imported (socket.ts → orchestrator) and
// CJS-required (dev hot-reload loader → offer API) instances of this module
// share the same ingest registry. Without this, each module instance has its
// own empty Map and offers see streamNotActive even when ingest is running.
interface BridgeSingletonState {
  ingestByCameraId: Map<string, CameraIngest>;
  allocatedPorts: Set<number>;
}

const SINGLETON_KEY = '__luckyStackCameraWebrtcBridgeState__';

const globalScope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: BridgeSingletonState;
};

const singletonState: BridgeSingletonState = globalScope[SINGLETON_KEY] ?? {
  ingestByCameraId: new Map<string, CameraIngest>(),
  allocatedPorts: new Set<number>(),
};

if (!globalScope[SINGLETON_KEY]) {
  globalScope[SINGLETON_KEY] = singletonState;
}

const ingestByCameraId = singletonState.ingestByCameraId;
const allocatedPorts = singletonState.allocatedPorts;

const basePort = (() => {
  const parsed = Number.parseInt(process.env.PI5_VIDEO_INGEST_PORT_BASE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5600;
})();

const allocateRtpPort = (): number => {
  for (let port = basePort; port < basePort + 1000; port += 2) {
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      return port;
    }
  }
  throw new Error('No free RTP port available for camera ingest');
};

const releaseRtpPort = (port: number): void => {
  allocatedPorts.delete(port);
};

const openRtpSocket = (rtpPort: number): Socket => {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (socketError) => {
    console.error(
      `cameraWebrtcBridge: rtp socket error on port ${String(rtpPort)}`,
      socketError,
    );
  });
  socket.bind(rtpPort, '0.0.0.0');
  return socket;
};

const attachRtpForwarder = (ingest: CameraIngest): void => {
  let packetsReceived = 0;
  let packetsForwarded = 0;

  ingest.socket.on('message', (msg: Buffer) => {
    packetsReceived += 1;
    if (packetsReceived === 1) {
      console.log(
        `cameraWebrtcBridge[${ingest.cameraId}] first RTP packet received on port ${String(ingest.rtpPort)} (size=${String(msg.length)})`,
      );
    }
    if (packetsReceived % 500 === 0) {
      console.log(
        `cameraWebrtcBridge[${ingest.cameraId}] rtp received=${String(packetsReceived)} forwarded=${String(packetsForwarded)} peers=${String(ingest.peers.size)}`,
      );
    }

    if (ingest.peers.size === 0) {
      return;
    }

    // werift's MediaStreamTrack.writeRtp accepts a parsed RtpPacket. Parse once,
    // then fan out to every attached peer so we don't pay the deserialize cost
    // per subscriber.
    let packet: RtpPacket;
    try {
      packet = RtpPacket.deSerialize(msg);
    } catch (parseError) {
      console.warn(
        `cameraWebrtcBridge[${ingest.cameraId}] rtp parse failed`,
        parseError,
      );
      return;
    }

    for (const peer of ingest.peers) {
      try {
        peer.track.writeRtp(packet);
        packetsForwarded += 1;
      } catch (writeError) {
        console.error(
          `cameraWebrtcBridge[${ingest.cameraId}] track.writeRtp failed`,
          writeError,
        );
      }
    }
  });
};

export const isCameraIngestRunning = (cameraId: string): boolean => {
  return ingestByCameraId.has(cameraId);
};

export const getCameraIngestRtpPort = (cameraId: string): number | null => {
  const ingest = ingestByCameraId.get(cameraId);
  return ingest ? ingest.rtpPort : null;
};

export const startCameraIngest = ({
  cameraId,
}: {
  cameraId: string;
}): { rtpPort: number } => {
  const existing = ingestByCameraId.get(cameraId);
  if (existing) {
    return { rtpPort: existing.rtpPort };
  }

  const rtpPort = allocateRtpPort();
  const socket = openRtpSocket(rtpPort);

  const ingest: CameraIngest = {
    cameraId,
    rtpPort,
    socket,
    peers: new Set(),
  };

  attachRtpForwarder(ingest);
  ingestByCameraId.set(cameraId, ingest);

  return { rtpPort };
};

export const stopCameraIngest = ({
  cameraId,
}: {
  cameraId: string;
}): void => {
  const ingest = ingestByCameraId.get(cameraId);
  if (!ingest) {
    return;
  }

  ingestByCameraId.delete(cameraId);

  for (const peer of ingest.peers) {
    try {
      peer.track.stop();
    } catch {
      // track may already be stopped.
    }
    void tryCatch(async () => peer.peerConnection.close());
  }
  ingest.peers.clear();

  try {
    ingest.socket.close();
  } catch {
    // socket may already be closed.
  }

  releaseRtpPort(ingest.rtpPort);
};

const waitForIceGathering = async (peerConnection: RTCPeerConnection): Promise<void> => {
  if (peerConnection.iceGatheringState === 'complete') {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutHandle = globalThis.setTimeout(() => {
      resolve();
    }, MAX_ICE_WAIT_MS);

    peerConnection.iceGatheringStateChange.subscribe((state) => {
      if (state === 'complete') {
        globalThis.clearTimeout(timeoutHandle);
        resolve();
      }
    });
  });
};

interface CreateCameraWebrtcAnswerParams {
  cameraId: string;
  offerSdp: string;
}

type CameraWebrtcAnswerResult =
  | {
      status: 'success';
      answerSdp: string;
      iceCandidates: IceCandidatePayload[];
    }
  | {
      status: 'error';
      errorCode:
        | 'camera.webrtcSignalingUnavailable'
        | 'camera.webrtcSignalingFailed'
        | 'camera.streamNotActive';
    };

export const createCameraWebrtcAnswer = async ({
  cameraId,
  offerSdp,
}: CreateCameraWebrtcAnswerParams): Promise<CameraWebrtcAnswerResult> => {
  const ingest = ingestByCameraId.get(cameraId);
  if (!ingest) {
    return { status: 'error', errorCode: 'camera.streamNotActive' };
  }

  // werift-side codec pin: the Pi Zero emits H.264 baseline RTP on payload type
  // 96, and we forward those packets verbatim, so the answer must advertise the
  // exact same codec/PT. profile-level-id=42e01f = Constrained Baseline 3.1.
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    codecs: {
      video: [useH264({ payloadType: 96 })],
    },
  });

  const track = new MediaStreamTrack({ kind: 'video' });
  peerConnection.addTransceiver(track, { direction: 'sendonly' });

  const peer: ForwardPeer = { peerConnection, track };
  ingest.peers.add(peer);

  const closeConnection = () => {
    ingest.peers.delete(peer);
    try {
      track.stop();
    } catch {
      // track may already be stopped.
    }
    void tryCatch(async () => peerConnection.close());
  };

  peerConnection.connectionStateChange.subscribe((state) => {
    if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      closeConnection();
    }
  });

  const [remoteDescriptionError] = await tryCatch(async () => {
    return peerConnection.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  });

  if (remoteDescriptionError) {
    console.error(
      `cameraWebrtcBridge[${cameraId}] setRemoteDescription failed`,
      remoteDescriptionError,
    );
    closeConnection();
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed' };
  }

  const [answerCreateError, answer] = await tryCatch(async () => {
    return peerConnection.createAnswer();
  });

  if (answerCreateError || !answer) {
    console.error(
      `cameraWebrtcBridge[${cameraId}] createAnswer failed`,
      answerCreateError,
    );
    closeConnection();
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed' };
  }

  const [setLocalDescriptionError] = await tryCatch(async () => {
    return peerConnection.setLocalDescription(answer);
  });

  if (setLocalDescriptionError) {
    console.error(
      `cameraWebrtcBridge[${cameraId}] setLocalDescription failed`,
      setLocalDescriptionError,
    );
    closeConnection();
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed' };
  }

  await waitForIceGathering(peerConnection);

  const rawAnswerSdp = peerConnection.localDescription?.sdp;
  if (!rawAnswerSdp) {
    console.error(
      `cameraWebrtcBridge[${cameraId}] localDescription sdp missing after ICE gathering`,
    );
    closeConnection();
    return { status: 'error', errorCode: 'camera.webrtcSignalingFailed' };
  }

  // Chrome's SDP parser requires every line (including the last) to end with \r\n.
  // werift omits the final terminator, so we normalize here. .trim() would make
  // things worse — that's what caused the "Invalid SDP line" rejection.
  const answerSdp = rawAnswerSdp.endsWith('\r\n') ? rawAnswerSdp : `${rawAnswerSdp}\r\n`;

  return {
    status: 'success',
    answerSdp,
    iceCandidates: [],
  };
};

export default createCameraWebrtcAnswer;
