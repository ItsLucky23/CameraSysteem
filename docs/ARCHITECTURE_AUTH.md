# Authentication Architecture

> OAuth and credentials-based authentication system.

---

## Quick Reference

```typescript
// Trigger OAuth login (redirects)
window.location.href = "/auth/api/google";

// Credentials login
const response = await fetch("/auth/api/credentials", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
```

---

## Supported Providers

| Provider    | Type           | Config Required   |
| ----------- | -------------- | ----------------- |
| Credentials | Email/Password | None (built-in)   |
| Google      | OAuth 2.0      | Client ID, Secret |
| GitHub      | OAuth 2.0      | Client ID, Secret |
| Discord     | OAuth 2.0      | Client ID, Secret |
| Facebook    | OAuth 2.0      | Client ID, Secret |
| Microsoft   | OAuth 2.0      | Client ID, Secret |

---

## Configuration

### Environment Variables

```bash
# .env
DNS=http://localhost:5173                    # Frontend URL
EXTERNAL_ORIGINS=https://myapp.com           # Allowed origins (comma-separated)

# OAuth Providers
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
FACEBOOK_CLIENT_ID=...
FACEBOOK_CLIENT_SECRET=...
```

### Provider Config (`server/auth/loginConfig.ts`)

```typescript
const oauthProviders = [
  {
    name: "google",
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorizationURL: "https://accounts.google.com/o/oauth2/auth",
    tokenURL: "https://oauth2.googleapis.com/token",
    callbackURL: `${process.env.DNS}/auth/callback/google`,
    scope: ["email", "profile"],
  },
  // ... other providers
];
```

---

## Login Flows

### OAuth Flow

```
1. User clicks "Login with Google"
   ↓
2. Redirect to: /auth/api/google
   ↓
3. Server generates and stores one-time OAuth state (short TTL)
  ↓
4. Server redirects to Google OAuth URL with code + state parameters
   ↓
5. User authenticates with Google
   ↓
6. Google redirects to: /auth/callback/google?code=...&state=...
   ↓
7. Server validates and consumes OAuth state (anti-CSRF)
   ↓
8. Server exchanges code for token
   ↓
9. Server fetches user profile from Google
   ↓
10. Server creates/finds user in database
   ↓
11. Server creates session in Redis
  ↓
12. Redirect to frontend with token cookie
```

### Credentials Flow

```
1. User submits email + password
   ↓
2. POST to: /auth/api/credentials
   ↓
3. Server validates credentials
   ↓
4. If action='register': Create user, hash password
   If action='login': Verify password hash
   ↓
5. Server creates session in Redis
   ↓
6. Return { status: true, session, newToken }
```

---

## Auth Endpoints

| Endpoint                    | Method | Purpose                        |
| --------------------------- | ------ | ------------------------------ |
| `/auth/api/{provider}`      | GET    | Initiate OAuth login           |
| `/auth/api/credentials`     | POST   | Credentials login/register     |
| `/auth/callback/{provider}` | GET    | OAuth callback (from provider) |

---

## API And SYNC Authorization

### Basic login requirement

```typescript
// In _api/*.ts
export const auth: AuthProps = {
  login: true, // User must be logged in
  additional: [], // No extra requirements
};
```

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `server/auth/login.ts` | `loginWithCredentials` | Handles credentials login/register, password checks, session creation. |
| `server/auth/login.ts` | `loginCallback` | Handles OAuth callback flow and provider profile mapping. |
| `server/auth/loginConfig.ts` | provider config | Defines OAuth provider metadata and endpoints. |
| `server/auth/checkOrigin.ts` | `default export` | Validates allowed origins for HTTP/socket requests. |
| `server/utils/validateRequest.ts` | `validateRequest` | Enforces `auth.additional` checks for APIs and sync handlers. |

### Role-based access

```typescript
export const auth: AuthProps = {
  login: true,
  additional: [
    {
      key: "admin",
      value: true, // User must have 'admin' role
    },
  ],
};
```

---

## Frontend Components

### Login Buttons

```tsx
function LoginPage() {
  return (
    <div>
      <button onClick={() => (window.location.href = "/auth/api/google")}>
        Login with Google
      </button>
      <button onClick={() => (window.location.href = "/auth/api/github")}>
        Login with GitHub
      </button>
    </div>
  );
}
```

### Middleware

```ts
switch (location) {
  case "/test":
    if (session?.email && session?.provider) {
      return { success: true };
    }
    return { redirect: "/login" };

  case "/admin":
    if (session?.email && session?.provider && session?.admin === true) {
      return { success: true };
    } else if (!session?.email || !session?.provider) {
      return { redirect: "/login" };
    } else if (!session?.admin) {
      notify.error({ key: "middleware.notAdmin" });
    }
    return;

  default:
    return { success: true };
}
```

---

## Security Considerations

1. **OAuth state** - One-time state is generated/validated to mitigate OAuth login CSRF
2. **CORS** - Only `DNS` and `EXTERNAL_ORIGINS` are allowed
3. **HttpOnly cookies** - Tokens not accessible via JavaScript
4. **bcrypt** - Passwords hashed with salt rounds
4. **CSRF** - WebSocket architecture inherently prevents CSRF
5. **Origin check** - Every request validates origin header
