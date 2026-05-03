import { createSocket, Socket } from 'node:dgram';

import { MediaStreamTrack, RtpPacket } from 'werift';

import { tryCatch } from '../functions/tryCatch';

// Audio mirrors the video bridge: per-camera UDP socket + RTP fan-out.
// Naming is from the SERVER's perspective:
//   audio ingest  = packets coming INTO the server from the Pi Zero mic
//                   (downlink to listening browsers)
//   audio egress  = packets the server sends OUT to the Pi Zero speaker
//                   (uplink originated by a talking browser)
// Both halves expose a subscribeRtp callback set so the recording manager can
// tee packets without joining the WebRTC fan-out path.

type AudioRtpSubscriber = (rtpBytes: Buffer) => void;

interface AudioIngest {
  cameraId: string;
  rtpPort: number;
  socket: Socket;
  audioTracks: Set<MediaStreamTrack>;
  rtpSubscribers: Set<AudioRtpSubscriber>;
  lastPacketAt: number | null;
}

interface AudioEgress {
  cameraId: string;
  cameraIp: string;
  remotePort: number;
  socket: Socket;
  rtpSubscribers: Set<AudioRtpSubscriber>;
  lastPacketAt: number | null;
}

interface AudioBridgeSingletonState {
  ingestByCameraId: Map<string, AudioIngest>;
  egressByCameraId: Map<string, AudioEgress>;
  allocatedIngestPorts: Set<number>;
  allocatedEgressPorts: Set<number>;
}

const SINGLETON_KEY = '__luckyStackCameraAudioBridgeState__';

const globalScope = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: AudioBridgeSingletonState;
};

const singletonState: AudioBridgeSingletonState = globalScope[SINGLETON_KEY] ?? {
  ingestByCameraId: new Map<string, AudioIngest>(),
  egressByCameraId: new Map<string, AudioEgress>(),
  allocatedIngestPorts: new Set<number>(),
  allocatedEgressPorts: new Set<number>(),
};

if (!globalScope[SINGLETON_KEY]) {
  globalScope[SINGLETON_KEY] = singletonState;
}

const ingestByCameraId = singletonState.ingestByCameraId;
const egressByCameraId = singletonState.egressByCameraId;
const allocatedIngestPorts = singletonState.allocatedIngestPorts;
const allocatedEgressPorts = singletonState.allocatedEgressPorts;

const ingestBasePort = (() => {
  const parsed = Number.parseInt(process.env.PI5_AUDIO_INGEST_PORT_BASE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6600;
})();

const egressBasePort = (() => {
  const parsed = Number.parseInt(process.env.PI5_AUDIO_EGRESS_PORT_BASE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7600;
})();

const allocatePort = (
  basePort: number,
  allocated: Set<number>,
  label: string,
): number => {
  for (let port = basePort; port < basePort + 1000; port += 2) {
    if (!allocated.has(port)) {
      allocated.add(port);
      return port;
    }
  }
  throw new Error(`No free ${label} port available`);
};

const releasePort = (port: number, allocated: Set<number>): void => {
  allocated.delete(port);
};

// ---------------------------------------------------------------------------
// INGEST  (Pi Zero mic -> server -> browsers)
// ---------------------------------------------------------------------------

const openIngestSocket = (rtpPort: number): Socket => {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (socketError) => {
    console.error(
      `cameraAudioBridge: ingest socket error on port ${String(rtpPort)}`,
      socketError,
    );
  });
  socket.bind(rtpPort, '0.0.0.0');
  return socket;
};

const attachIngestForwarder = (ingest: AudioIngest): void => {
  let packetsReceived = 0;

  ingest.socket.on('message', (msg: Buffer) => {
    packetsReceived += 1;
    ingest.lastPacketAt = Date.now();
    if (packetsReceived === 1) {
      console.log(
        `cameraAudioBridge[${ingest.cameraId}] first audio RTP packet received on port ${String(ingest.rtpPort)} (size=${String(msg.length)})`,
      );
    }
    if (packetsReceived % 1000 === 0) {
      console.log(
        `cameraAudioBridge[${ingest.cameraId}] audio rtp received=${String(packetsReceived)} subscribers=${String(ingest.rtpSubscribers.size)} tracks=${String(ingest.audioTracks.size)}`,
      );
    }

    // Recording-side fan-out first; a slow subscriber must not block delivery
    // to the WebRTC peers.
    if (ingest.rtpSubscribers.size > 0) {
      for (const subscriber of ingest.rtpSubscribers) {
        try {
          subscriber(msg);
        } catch (subscriberError) {
          console.error(
            `cameraAudioBridge[${ingest.cameraId}] audio subscriber threw`,
            subscriberError,
          );
        }
      }
    }

    if (ingest.audioTracks.size === 0) {
      return;
    }

    let packet: RtpPacket;
    try {
      packet = RtpPacket.deSerialize(msg);
    } catch (parseError) {
      console.warn(
        `cameraAudioBridge[${ingest.cameraId}] audio rtp parse failed`,
        parseError,
      );
      return;
    }

    for (const track of ingest.audioTracks) {
      try {
        track.writeRtp(packet);
      } catch (writeError) {
        console.error(
          `cameraAudioBridge[${ingest.cameraId}] audio track.writeRtp failed`,
          writeError,
        );
      }
    }
  });
};

export const isCameraAudioIngestRunning = (cameraId: string): boolean => {
  return ingestByCameraId.has(cameraId);
};

export const getCameraAudioIngestPort = (cameraId: string): number | null => {
  return ingestByCameraId.get(cameraId)?.rtpPort ?? null;
};

export const getCameraAudioIngestLastPacketAt = (cameraId: string): number | null => {
  return ingestByCameraId.get(cameraId)?.lastPacketAt ?? null;
};

export const startCameraAudioIngest = ({ cameraId }: { cameraId: string }): { rtpPort: number } => {
  const existing = ingestByCameraId.get(cameraId);
  if (existing) {
    return { rtpPort: existing.rtpPort };
  }

  const rtpPort = allocatePort(ingestBasePort, allocatedIngestPorts, 'audio ingest');
  const socket = openIngestSocket(rtpPort);

  const ingest: AudioIngest = {
    cameraId,
    rtpPort,
    socket,
    audioTracks: new Set(),
    rtpSubscribers: new Set(),
    lastPacketAt: null,
  };

  attachIngestForwarder(ingest);
  ingestByCameraId.set(cameraId, ingest);
  return { rtpPort };
};

export const stopCameraAudioIngest = ({ cameraId }: { cameraId: string }): void => {
  const ingest = ingestByCameraId.get(cameraId);
  if (!ingest) {
    return;
  }
  ingestByCameraId.delete(cameraId);

  for (const track of ingest.audioTracks) {
    try {
      track.stop();
    } catch {
      /* track may already be stopped */
    }
  }
  ingest.audioTracks.clear();
  ingest.rtpSubscribers.clear();

  try {
    ingest.socket.close();
  } catch {
    /* socket may already be closed */
  }

  releasePort(ingest.rtpPort, allocatedIngestPorts);
};

// Attach a per-peer audio MediaStreamTrack to the ingest fan-out. Returns
// an unsubscribe so the WebRTC layer can detach when the peer is closed.
export const attachAudioIngestTrack = (
  cameraId: string,
  track: MediaStreamTrack,
): (() => void) => {
  const ingest = ingestByCameraId.get(cameraId);
  if (!ingest) {
    return () => {
      /* nothing to detach */
    };
  }
  ingest.audioTracks.add(track);
  return () => {
    const current = ingestByCameraId.get(cameraId);
    if (!current) return;
    current.audioTracks.delete(track);
  };
};

// Recording manager subscribes to raw RTP bytes for the camera-mic direction.
export const subscribeAudioIngestRtp = (
  cameraId: string,
  callback: AudioRtpSubscriber,
): (() => void) => {
  const ingest = ingestByCameraId.get(cameraId);
  if (!ingest) {
    return () => {
      /* nothing to detach */
    };
  }
  ingest.rtpSubscribers.add(callback);
  return () => {
    const current = ingestByCameraId.get(cameraId);
    if (!current) return;
    current.rtpSubscribers.delete(callback);
  };
};

// ---------------------------------------------------------------------------
// EGRESS  (browser -> server -> Pi Zero speaker)
// ---------------------------------------------------------------------------

export const isCameraAudioEgressRunning = (cameraId: string): boolean => {
  return egressByCameraId.has(cameraId);
};

export const getCameraAudioEgressPort = (cameraId: string): number | null => {
  return egressByCameraId.get(cameraId)?.remotePort ?? null;
};

export const startCameraAudioEgress = ({
  cameraId,
  cameraIp,
}: {
  cameraId: string;
  cameraIp: string;
}): { remotePort: number } => {
  const existing = egressByCameraId.get(cameraId);
  if (existing) {
    if (existing.cameraIp !== cameraIp) {
      // IP changed (camera record edited). Update the destination so the
      // next packet goes to the right host without rebinding the socket.
      existing.cameraIp = cameraIp;
    }
    return { remotePort: existing.remotePort };
  }

  const remotePort = allocatePort(egressBasePort, allocatedEgressPorts, 'audio egress');
  // Send-only UDP socket. We never bind a local port — the kernel picks one
  // ephemeral port for outbound packets, which is fine because the Pi Zero
  // doesn't reply to the audio downlink.
  const socket = createSocket({ type: 'udp4' });
  socket.on('error', (socketError) => {
    console.error(
      `cameraAudioBridge: egress socket error for ${cameraId}`,
      socketError,
    );
  });

  const egress: AudioEgress = {
    cameraId,
    cameraIp,
    remotePort,
    socket,
    rtpSubscribers: new Set(),
    lastPacketAt: null,
  };

  egressByCameraId.set(cameraId, egress);
  return { remotePort };
};

export const stopCameraAudioEgress = ({ cameraId }: { cameraId: string }): void => {
  const egress = egressByCameraId.get(cameraId);
  if (!egress) {
    return;
  }
  egressByCameraId.delete(cameraId);
  egress.rtpSubscribers.clear();

  try {
    egress.socket.close();
  } catch {
    /* socket may already be closed */
  }

  releasePort(egress.remotePort, allocatedEgressPorts);
};

// Forward an RTP packet that arrived from a browser's WebRTC audio track to
// the Pi Zero's audio_subscriber listening port. Also fans out to recording
// subscribers so the egress direction lands in the recording mux.
export const writeAudioEgressRtp = (cameraId: string, rtpBytes: Buffer): void => {
  const egress = egressByCameraId.get(cameraId);
  if (!egress) {
    return;
  }
  egress.lastPacketAt = Date.now();

  if (egress.rtpSubscribers.size > 0) {
    for (const subscriber of egress.rtpSubscribers) {
      try {
        subscriber(rtpBytes);
      } catch (subscriberError) {
        console.error(
          `cameraAudioBridge[${cameraId}] egress subscriber threw`,
          subscriberError,
        );
      }
    }
  }

  void tryCatch(async () =>
    new Promise<void>((resolve) => {
      egress.socket.send(rtpBytes, egress.remotePort, egress.cameraIp, (sendError) => {
        if (sendError) {
          console.warn(
            `cameraAudioBridge[${cameraId}] egress udp send failed: ${sendError.message}`,
          );
        }
        resolve();
      });
    }),
  );
};

// Recording manager subscribes to the egress (browser-to-Pi) direction so the
// recorded mix carries both halves of the conversation.
export const subscribeAudioEgressRtp = (
  cameraId: string,
  callback: AudioRtpSubscriber,
): (() => void) => {
  const egress = egressByCameraId.get(cameraId);
  if (!egress) {
    return () => {
      /* nothing to detach */
    };
  }
  egress.rtpSubscribers.add(callback);
  return () => {
    const current = egressByCameraId.get(cameraId);
    if (!current) return;
    current.rtpSubscribers.delete(callback);
  };
};
