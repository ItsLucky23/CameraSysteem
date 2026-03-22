import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

import handleApiRequest from "./handleApiRequest";
import { getSession, saveSession } from "../functions/session";
import { Server as SocketIOServer } from 'socket.io';
import handleSyncRequest from "./handleSyncRequest";
import allowedOrigin from '../auth/checkOrigin';
import { initAcitivityBroadcaster, socketConnected, socketDisconnecting, socketLeaveRoom } from './utils/activityBroadcaster';
import config, { SessionLayout } from '../../config';
import { extractTokenFromSocket } from '../utils/extractToken';

//? Per-token lock to serialize session mutations (prevents read-modify-write races)
const sessionLocks = new Map<string, Promise<void>>();
const withSessionLock = async (token: string, fn: () => Promise<void>) => {
  const prev = sessionLocks.get(token) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(token, next);
  try { await next; } finally {
    //? Clean up if no more pending operations
    if (sessionLocks.get(token) === next) sessionLocks.delete(token);
  }
};

export type apiMessage = {
  name: string;
  data: object;
  responseIndex: number;
}

export type syncMessage = {
  name: string;
  data: object;
  cb: string;
  receiver: string;
  responseIndex?: number;
  ignoreSelf?: boolean;
}

export let ioInstance: SocketIOServer | null = null;

const getVisibleSocketRooms = (socket: any, token: string | null): string[] => {
  return Array.from(socket.rooms)
    .filter((room): room is string => typeof room === 'string')
    .filter((room) => room !== socket.id)
    .filter((room) => !token || room !== token);
};

const getSessionRoomCodes = (session: SessionLayout): string[] => {
  const roomCodes = Array.isArray(session.roomCodes)
    ? session.roomCodes.filter((roomCode): roomCode is string => typeof roomCode === 'string' && roomCode.length > 0)
    : [];

  return Array.from(new Set(roomCodes));
};

const sanitizeSessionRoomKeys = (session: SessionLayout): SessionLayout => {
  const { code: _legacyCode, codes: _legacyCodes, ...sanitizedSession } = session as SessionLayout & { code?: string; codes?: string[] };
  return sanitizedSession;
};

export default function loadSocket(httpServer: any) {

  //? here we create the SocketIOServer instance
  const io = new SocketIOServer(httpServer, {
    cors: {
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      origin: (origin, callback) => {
        if (!origin || allowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB
  });

  ioInstance = io;

  console.log('SocketIO server initialized', 'green');

  //? when a client connects to the SocketIO server we extract their token and set up event handlers
  io.on('connection', (socket) => {
    const token = extractTokenFromSocket(socket);

    if (token) {
      socketConnected({ token, io });
    }

    socket.on('apiRequest', async (msg: apiMessage) => {
      handleApiRequest({ msg, socket, token });
    });
    socket.on('sync', async (msg: syncMessage) => {
      handleSyncRequest({ msg, socket, token });
    });
    socket.on('joinRoom', async (data) => {
      const group = typeof data?.group === 'string' ? data.group.trim() : '';
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }
      if (!token) {
        socket.emit(`joinRoom-${responseIndex}`, { error: 'Not authenticated' });
        return;
      }
      if (!group) {
        socket.emit(`joinRoom-${responseIndex}`, { error: 'Invalid room' });
        return;
      }
      await withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(`joinRoom-${responseIndex}`, { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = Array.from(new Set([...existingRoomCodes, group]));

        await socket.join(group);
        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });
        socket.emit(`joinRoom-${responseIndex}`, { rooms: getVisibleSocketRooms(socket, token) });
        console.log(`Socket ${socket.id} joined group ${group}`, 'cyan');
      });
    });

    socket.on('leaveRoom', async (data) => {
      const group = typeof data?.group === 'string' ? data.group.trim() : '';
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

      if (!token) {
        socket.emit(`leaveRoom-${responseIndex}`, { error: 'Not authenticated' });
        return;
      }

      if (!group) {
        socket.emit(`leaveRoom-${responseIndex}`, { error: 'Invalid room' });
        return;
      }

      await withSessionLock(token, async () => {
        const session = await getSession(token);
        if (!session) {
          socket.emit(`leaveRoom-${responseIndex}`, { error: 'Session not found' });
          return;
        }

        const existingRoomCodes = getSessionRoomCodes(session);
        const nextRoomCodes = existingRoomCodes.filter((roomCode) => roomCode !== group);

        await socket.leave(group);

        const sanitizedSession = sanitizeSessionRoomKeys(session);
        await saveSession(token, { ...sanitizedSession, roomCodes: nextRoomCodes });

        socket.emit(`leaveRoom-${responseIndex}`, { rooms: getVisibleSocketRooms(socket, token) });
        console.log(`Socket ${socket.id} left group ${group}`, 'cyan');
      });
    });

    socket.on('getJoinedRooms', (data) => {
      const responseIndex = data?.responseIndex;
      if (typeof responseIndex !== 'number') {
        return;
      }

      if (!token) {
        socket.emit(`getJoinedRooms-${responseIndex}`, { error: 'Not authenticated', rooms: [] });
        return;
      }

      socket.emit(`getJoinedRooms-${responseIndex}`, { rooms: getVisibleSocketRooms(socket, token) });
    });

    socket.on('disconnect', async (reason) => {
      if (config.socketActivityBroadcaster && token) {
        socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) { return; }
        console.log(`user disconnected, reason: ${reason}`, 'yellow');
      }
    });

    socket.on('updateLocation', async (newLocation) => {
      if (!token) { return; }
      if (!config.locationProviderEnabled) { return; }
      console.log('updating location to: ', newLocation.pathName, 'yellow')

      await withSessionLock(token, async () => {
        let returnedUser: SessionLayout | null = null;
        if (config.socketActivityBroadcaster) {
          returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
        }

        if (!newLocation) { return; }
        const user = returnedUser || await getSession(token);
        if (!user) { return; }

        const extendedUser = user as SessionLayout & { location?: SessionLayout };

        extendedUser.location = newLocation;
        await saveSession(token, user);
      });
    });

    if (config.socketActivityBroadcaster && token) {
      initAcitivityBroadcaster({ socket, token });
    }

    if (token) {
      socket.join(token);
    }

  });
  return io;
}