import { LANGUAGE, THEME, User } from "@prisma/client";

type AppEnvironmentConfig = {
  backendUrl: string;
  dev: boolean;
  sessionBasedToken?: boolean;
  allowMultipleSessions?: boolean;
};

const normalizeDns = (dns: string): string => dns.replace(/\/+$/, "");

const dnsEnvironmentMap: Record<string, AppEnvironmentConfig> = {
  "http://localhost:5174": {
    backendUrl: "http://localhost:81",
    dev: true,
    sessionBasedToken: true,
    allowMultipleSessions: true
  },
  "https://staging.server.com": {
    backendUrl: "https://staging.server.com",
    dev: false,
    sessionBasedToken: false,
    allowMultipleSessions: false
  },
  "https://app.server.com": {
    backendUrl: "https://app.server.com",
    dev: false,
    sessionBasedToken: false,
    allowMultipleSessions: false
  },
};

const detectedDns = normalizeDns(
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.DNS ?? "http://localhost:5174"),
);

const resolvedEnvironment =
  dnsEnvironmentMap[detectedDns] ?? dnsEnvironmentMap["http://localhost:5174"];

const config = {
  /** The URL of the backend server. Update for production. */
  backendUrl: resolvedEnvironment.backendUrl,
 
  /** Enable extra console logs for debugging */
  dev: resolvedEnvironment.dev,
 
  /** Enable mobile-friendly console overlay (useful for debugging on phones) */
  mobileConsole: false,

  /** The title of the page */
  pageTitle: "LuckyStack",
 
  /** URL to redirect unauthenticated users */
  loginPageUrl: '/login',
 
  /** URL to redirect after successful login */
  loginRedirectUrl: '/examples',
 
  /**
   * If false, logging in on a new device will automatically sign out all other sessions.
   * Useful for security-sensitive apps. Set to true to allow multiple simultaneous sessions.
   */
  allowMultipleSessions: resolvedEnvironment.allowMultipleSessions ?? false,
 
  /** 
    * Controls where auth tokens are read/written.
    * false: token is kept in HttpOnly cookies (shared across tabs, more secure).
    * true: token is kept in sessionStorage (tab-scoped sessions, useful for multi-account testing).
  */
  sessionBasedToken: resolvedEnvironment.sessionBasedToken ?? false,

  /**
   * Number of days before a session expires in Redis.
   * After this time, users will need to log in again.
   */
  sessionExpiryDays: 7,
 
  /**
   * Enable multiplayer awareness broadcasting.
   *
   * When FALSE:
   * - Sync events work normally between users in the same room
   * - Users don't know each other's connection status
   *
   * When TRUE:
   * - Users in the same room can see each other's status (online/AFK/reconnecting)
   * - Status is available via useSocketStatus() hook from SocketStatusProvider
   * - Useful for: multiplayer games, collaborative editors, presence indicators
   *
   * @example
   * ```tsx
   * import { useSocketStatus } from 'src/_providers/socketStatusProvider';
   *
   * function UserList() {
   *   const { socketStatus } = useSocketStatus();
   *   // socketStatus['user-id'] = { status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' }
   * }
   * ```
   */
  socketActivityBroadcaster: false,
 
  /** Default language for notifications and UI (matches files in src/_locales/) */
  defaultLanguage: 'en' as LANGUAGE,
 
  /** Default theme when user hasn't set a preference */
  defaultTheme: 'light' as THEME,

  /**
   * Rate limiting configuration for API requests.
   * Uses in-memory storage (suitable for single-server deployments).
   * 
   * @example Per-API override:
   * ```typescript
   * // In any _api/*.ts file
   * export const rateLimit = 60;    // 60 requests/minute
   * export const rateLimit = false; // Disable for this API
   * ```
   */
  rateLimiting: {
    /** Fallback requests per minute for any API that does not export its own rateLimit. */
    defaultApiLimit: 60 as number | false,
    /** Global requests per minute per IP across all API routes combined. */
    defaultIpLimit: 100 as number | false,
    /** Request window duration in milliseconds used by both limits. */
    windowMs: 60000,
  },
};
 
// ============================================
// TYPE DEFINITIONS
// ============================================
 
export interface SessionLayout extends Omit<User, 'password'> {
  avatarFallback: string;
  token: string;
  roomCodes?: string[];
  location?: {
    pathName: string;
    searchParams: {
      [key: string]: string;
    };
  };
} 
 
/**
 * Authentication configuration for API and Sync handlers.
 *
 * @example
 * ```typescript
 * // Require login only
 * export const auth: AuthProps = { login: true };
 *
 * // Require admin user
 * export const auth: AuthProps = {
 *   login: true,
 *   additional: [{ key: 'admin', value: true }]
 * };
 * ```
 */
export interface AuthProps {
  /** If true, user must have a valid session with an ID */
  login: boolean;
 
  /** Additional validation rules for session properties */
  additional?: {
    /** The session property to check (e.g., 'admin', 'email') */
    key: keyof SessionLayout;
 
    /** Exact value the property must equal (strict comparison) */
    value?: any;
 
    /** Type the property must be */
    type?: 'string' | 'number' | 'boolean';
 
    /** If true, property must be null/undefined. If false, must NOT be null/undefined */
    nullish?: boolean;
 
    /** If true, property must be falsy. If false, must be truthy */
    mustBeFalsy?: boolean;
  }[]
}
 
/** Supported OAuth providers */
export const providers = ['credentials', 'google', 'github', 'facebook', 'discord'];
 
export default config;
export const {
  backendUrl,
  dev,
  loginPageUrl,
  loginRedirectUrl,
  defaultLanguage,
  mobileConsole,
  allowMultipleSessions,
  sessionBasedToken,
  sessionExpiryDays,
  socketActivityBroadcaster,
  rateLimiting,
  pageTitle
} = config;