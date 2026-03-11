/**
 * Session management utilities for Redis-backed user sessions.
 *
 * Features:
 * - Save/retrieve/delete sessions from Redis
 * - Configurable session expiry (config.sessionExpiryDays)
 * - Optional session enforcement (config.allowMultipleSessions)
 * - Real-time session updates to connected clients
 */

// import type { SessionLayout } from "config";

import config, { SessionLayout } from "../../config";
import redis from "./redis";
import { captureException } from "./sentry";

/** Convert days to seconds for Redis TTL */
const SESSION_TTL = 60 * 60 * 24 * (config.sessionExpiryDays || 7);

/**
 * Save or update a user session in Redis.
 *
 * @param token - The session token (unique identifier)
 * @param data - The session data to store
 * @param newUser - If true, this is a new login (triggers single-session enforcement)
 */
const saveSession = async (token: string, data: SessionLayout, newUser?: boolean): Promise<void> => {
  try {
    const sessionKey = `${process.env.PROJECT_NAME}-session:${token}`;
    await redis.set(sessionKey, JSON.stringify(data));
    await redis.expire(sessionKey, SESSION_TTL);

    const { ioInstance } = await import('../sockets/socket');
    const io = ioInstance;
    if (!io) { return; }

    const userId = data?.id;

    // Always track active tokens so server-side user/session updates can fan out in real time
    if (userId) {
      const activeUsersKey = `${process.env.PROJECT_NAME}-activeUsers:${userId}`;
      await redis.sadd(activeUsersKey, token);
      await redis.expire(activeUsersKey, SESSION_TTL);
    }

    // Handle single-session enforcement on new login
    if (newUser && config.allowMultipleSessions === false) {
      if (!userId) return;

      const activeUsersKey = `${process.env.PROJECT_NAME}-activeUsers:${userId}`;
      // const previousTokens = await redis.smembers(activeUsersKey);

      const allTokens = await redis.smembers(activeUsersKey);
      // Exclude the current token — it was just added and has no socket room yet
      const previousTokens = allTokens.filter(t => t !== token);

      if (previousTokens.length > 0) {
        const { logout } = await import('../sockets/utils/logout');

        // Kick all previous sessions for this user
        await Promise.all(previousTokens.map(async (previousToken) => {
          const sockets = io.sockets.adapter.rooms.get(previousToken);
          if (sockets) {
            console.log(`Kicking previous session for user ${userId}`, 'yellow');
            for (const socketId of sockets) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                await logout({ token: previousToken, socket, userId });
              }
            }
          } else {
            // No active sockets, just clean up Redis
            await redis.del(`${process.env.PROJECT_NAME}-session:${previousToken}`);
            await redis.srem(activeUsersKey, previousToken);
          }
        }));
      }
    }

    // Broadcast session updates to connected clients
    if (io.sockets.adapter.rooms.has(token)) {
      io.to(token).emit('updateSession', JSON.stringify(data));
    }
  } catch (error) {
    console.log('Error saving session:', error, 'red');
    captureException(error, { fn: 'saveSession', token });
  }
};

/**
 * Retrieve a user session from Redis.
 *
 * @param token - The session token
 * @returns The session data or null if not found
 */
const getSession = async (token: string | null): Promise<SessionLayout | null> => {
  if (!token) return null;

  try {
    const session = await redis.get(`${process.env.PROJECT_NAME}-session:${token}`);
    if (!session) return null;

    const parsed = JSON.parse(session);
    if (!parsed) return null;

    return { ...parsed, token };
  } catch (error) {
    console.log('Error getting session:', error, 'red');
    captureException(error, { fn: 'getSession', token });
    return null;
  }
};

/**
 * Delete a user session from Redis and notify connected clients.
 *
 * @param token - The session token to delete
 * @returns true if successful
 */
const deleteSession = async (token: string): Promise<boolean> => {
  try {
    const user = await redis.get(`${process.env.PROJECT_NAME}-session:${token}`);

    if (user) {
      const userId = JSON.parse(user)?.id;
      if (userId) {
        const activeUsersKey = `${process.env.PROJECT_NAME}-activeUsers:${userId}`;
        const { ioInstance } = await import('../sockets/socket');

        // Notify connected clients to logout
        if (ioInstance?.sockets.adapter.rooms.has(token)) {
          ioInstance.to(token).emit('forceLogout');
        }

        await redis.srem(activeUsersKey, token);
      }
    }

    await redis.del(`${process.env.PROJECT_NAME}-session:${token}`);
    return true;
  } catch (error) {
    console.log('Error deleting session:', error, 'red');
    captureException(error, { fn: 'deleteSession', token });
    return false;
  }
};

/**
 * Get all active sessions (admin utility).
 *
 * @returns Array of all session data
 */
const getAllSessions = async (): Promise<SessionLayout[]> => {
  try {
    const keys = await redis.keys(`${process.env.PROJECT_NAME}-session:*`);
    const sessions = await Promise.all(keys.map((key) => redis.get(key)));
    return sessions.map((s) => JSON.parse(s || "{}"));
  } catch (error) {
    console.log('Error getting all sessions:', error, 'red');
    captureException(error, { fn: 'getAllSessions' });
    return [];
  }
};

export { saveSession, getSession, deleteSession, getAllSessions };

