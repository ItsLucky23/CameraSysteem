import { IncomingMessage } from 'http';
import config from '../../config';

/**
 * Extract the authentication token from an HTTP request.
 * 
 * Supports tokens from:
 * - `Authorization: Bearer <token>` header
 * - `token=<token>` cookie
 * 
 * @param req - The HTTP incoming message
 * @returns The token string or null if not found
 * 
 * @example
 * ```typescript
 * const token = extractTokenFromRequest(req);
 * const session = token ? await getSession(token) : null;
 * ```
 */
export const extractTokenFromRequest = (req: IncomingMessage): string | null => {
  // Strict extraction by configured token mode.
  if (config.sessionBasedToken) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const tokenCookie = cookieHeader
      .split('; ')
      .find(row => row.startsWith('token='));

    if (tokenCookie) {
      return tokenCookie.split('=')[1] ?? null;
    }
  }

  return null;
};
