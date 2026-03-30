# LuckyStack v2

A **socket-first full-stack framework** for building real-time web applications with React and Node.js.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8-black)](https://socket.io/)
[![Tailwind](https://img.shields.io/badge/Tailwind-4.0-38B2AC)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-2D3748)](https://www.prisma.io/)

---

## What is LuckyStack?

LuckyStack is a custom full-stack framework that takes a **socket-first approach** to client-server communication. Instead of traditional REST APIs, all communication happens over WebSockets, enabling:

- **Real-time sync** between clients in the same room
- **Multiplayer awareness** (AFK detection, user presence)
- **Unified RPC-style API calls** with automatic session handling
- **Built-in authentication** (credentials + OAuth providers)

## Key Features

| Feature                | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| **Socket-First**       | All client-server communication via Socket.io         |
| **Authentication**     | Credentials + Google, GitHub, Discord, Facebook OAuth |
| **Room System**        | Join rooms for targeted real-time sync                |
| **Activity Awareness** | Track user AFK status and presence                    |
| **File-Based Routing** | Next.js-style page and API routing                    |
| **Tailwind v4**        | Modern CSS with custom theming                        |
| **Redis Sessions**     | Scalable session storage                              |
| **Prisma + MongoDB**   | Type-safe database access                             |
| **Sentry Integration** | Error monitoring for client and server                |

---

## Quick Start

### Prerequisites

- Docker + Docker Compose

### Installation

```bash
# Clone the repository
git clone https://github.com/ItsLucky23/LuckyStack-v2 PROJECT_NAME
cd PROJECT_NAME

# Copy environment template
cp .env_template .env
cp .env.local_template .env.local
cp configTemplate.txt config.ts

# Start all services (client, server, MongoDB, Redis)
docker compose up
```

MongoDB and Redis are included in the Docker setup — no separate installation needed.

> **Without Docker:** Install Node.js 18+, Redis 6+, and MongoDB manually, then run `npm install && npm run server` / `npm run client`.

### Access the App

You can change the ports in the `.env` file.

- **Frontend:** http://localhost:5173
- **Backend:** http://localhost:80

---

## Documentation

| Document                                                   | Description                                |
| ---------------------------------------------------------- | ------------------------------------------ |
| [Routing architecture](./docs/ARCHITECTURE_ROUTING.md)     | File-based routing (pages, APIs, syncs)    |
| [API architecture](./docs/ARCHITECTURE_API.md)             | API architecture overview                  |
| [Authentication architecture](./docs/ARCHITECTURE_AUTH.md) | Authentication architecture overview       |
| [Session architecture](./docs/ARCHITECTURE_SESSION.md)     | Session architecture overview              |
| [Socket architecture](./docs/ARCHITECTURE_SOCKET.md)       | Socket architecture overview               |
| [Sync architecture](./docs/ARCHITECTURE_SYNC.md)           | Sync architecture overview                 |
| [Developer guide](./docs/DEVELOPER_GUIDE.md)               | Developer guide                            |
| [Hosting guide](./docs/HOSTING.md)                         | Deployment and hosting guide               |

---

## Project Structure

```
LuckyStack-v2/
├── server/                 # Backend (Node.js)
│   ├── auth/               # Authentication (OAuth + credentials)
│   ├── sockets/            # Socket.io handlers
│   │   ├── socket.ts       # Main socket server
│   │   ├── handleApiRequest.ts
│   │   └── handleSyncRequest.ts
│   ├── functions/          # Server utilities (session, db, redis)
│   └── utils/              # Shared utilities
│
├── src/                    # Frontend (React)
│   ├── _components/        # Shared UI components
│   ├── _sockets/           # Socket client utilities
│   ├── _providers/         # React context providers
│   ├── _functions/         # Client utilities
│   └── {page}/             # Page routes
│       ├── page.tsx        # Page component
│       ├── _api/           # Server-only API endpoints
│       └── _sync/          # Real-time sync handlers
│
├── scripts/                # Build scripts
├── prisma/                 # Database schema
└── config.ts               # Application configuration
```

---

## API vs Sync

LuckyStack distinguishes between two types of server communication:

### API Requests

Server-only operations (database queries, external APIs):

```typescript
// Client
const result = await apiRequest({
  name: "getUserData",
  data: { userId: "123" },
});

// Server: src/settings/_api/getUserData.ts
export const auth = { login: true };
export const main = async ({ data, user, functions }) => {
  return await functions.prisma.user.findUnique({ where: { id: data.userId } });
};
```

### Sync Requests

Real-time events between clients:

```typescript
// Client: Send to all users in room
await syncRequest({
  name: "cursorMove",
  data: { x: 100, y: 200 },
  receiver: "room-abc123",
  ignoreSelf: true,
});

// All other clients in the room receive the event
```

---

## Scripts

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `docker compose up`      | Start all services (recommended)     |
| `docker compose up -d`   | Start all services in the background |
| `docker compose down`    | Stop all services                    |
| `npm run client`         | Start Vite dev server (no Docker)    |
| `npm run server`         | Start Node.js server (no Docker)     |
| `npm run build`          | Build for production                 |
| `npm run prod`           | Run production server                |

---

## Configuration

### Environment Variables

See [`.env_template`](./.env_template) for all available options:

- `NODE_ENV` - development or production
- `DNS` - Public URL for OAuth redirects
- `REDIS_HOST` / `REDIS_PASSWORD` / `REDIS_PORT` - Redis connection
- `DATABASE_URL` - MongoDB connection string
- `SENTRY_DSN` / `VITE_SENTRY_DSN` - Error monitoring DSNs (server/client)
- `SENTRY_ENABLED` / `VITE_SENTRY_ENABLED` - Optional development override

Environment file model:

- `.env_template` and `.env` are safe config context and can contain placeholder values such as `ID_IN_ENV_LOCAL` and `SECRET_IN_ENV_LOCAL`
- `.env.local_template` is the template for local secrets
- `.env.local` stores real secrets and overrides `.env` via `dotenv`
- Keep non-secret server config in `.env` so AI tooling can understand expected keys without exposing real values

### OAuth Setup

1. Create OAuth apps at each provider
2. Set callback URLs to `https://your-domain.com/auth/callback/{provider}`
3. Keep placeholders in `.env` and add real client ID/secret values to `.env.local`

Supported: Google, GitHub, Discord, Facebook

---

## Tech Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| **Frontend**   | React 19, React Router 7, TailwindCSS 4 |
| **Backend**    | Node.js (raw HTTP), Socket.io           |
| **Database**   | MongoDB with Prisma 6.5 ORM             |
| **Sessions**   | Redis                                   |
| **Auth**       | Custom OAuth + bcrypt                   |
| **Icons**      | Lucide React, Font Awesome              |
| **Monitoring** | Sentry                                  |
| **Build**      | Vite, TypeScript, tsx                   |

---

## License

MIT

---

## Links

- 📖 [GitBook Documentation](https://lucky23.gitbook.io/luckystack/)
