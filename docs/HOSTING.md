# Hosting LuckyStack

This guide covers everything you need to deploy LuckyStack from development to production.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Development Setup](#development-setup)
3. [Production Build](#production-build)
4. [Deployment Options](#deployment-options)
   - [VPS with nginx](#vps-deployment-with-nginx)
   - [VPS with Caddy](#vps-deployment-with-caddy)
   - [Docker](#docker-deployment)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before deploying LuckyStack, ensure you have:

| Requirement  | Version | Notes                                            |
| ------------ | ------- | ------------------------------------------------ |
| **Node.js**  | 18+     | LTS recommended                                  |
| **Redis**    | 6+      | Used for session storage                         |
| **Database** | -       | Your choice (see database section below)         |
| **npm**      | 9+      | Comes with Node.js                               |

### Database

LuckyStack uses **Prisma** as its ORM, which supports multiple database providers. Choose whichever fits your project:

| Provider       | Config Value   | Notes                                              |
| -------------- | -------------- | -------------------------------------------------- |
| **MongoDB**    | `mongodb`      | Currently active in `prisma/schema.prisma`         |
| **MySQL**      | `mysql`        | Uncomment in schema, update `DATABASE_URL`         |
| **PostgreSQL** | `postgresql`   | Uncomment in schema, update `DATABASE_URL`         |
| **SQLite**     | `sqlite`       | Uncomment in schema, no server needed (dev only)   |

To switch databases:
1. Open `prisma/schema.prisma`
2. Comment out the current `datasource db` block
3. Uncomment the one for your chosen provider
4. Adjust the `id` field syntax if switching between MongoDB and SQL (see comments in schema)
5. Update `DATABASE_URL` in `.env`
6. Run `npx prisma generate && npx prisma db push`

### Installing Redis

**Windows (WSL/Docker recommended):**
```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:alpine

# Or download from https://github.com/microsoftarchive/redis/releases
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

### Installing a Database

**MongoDB (if using MongoDB provider):**

Use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (free tier available) or install locally.

> Local MongoDB installations must be configured as a **Replica Set** to support transactions.

Docker:
```bash
docker run -d --name mongodb -p 27017:27017 mongo:latest --replSet rs0
docker exec -it mongodb mongosh --eval "rs.initiate()"
```

**MySQL (if using MySQL provider):**
```bash
# Docker
docker run -d --name mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=password mysql:latest

# Then set DATABASE_URL="mysql://root:password@localhost:3306/PROJECT_NAME"
```

**PostgreSQL (if using PostgreSQL provider):**
```bash
# Docker
docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:latest

# Then set DATABASE_URL="postgresql://postgres:password@localhost:5432/PROJECT_NAME"
```

**SQLite (development only):**

No installation needed. Set the datasource in `prisma/schema.prisma` to:
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

---

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/ItsLucky23/LuckyStack-v2 <PROJECT_NAME>
cd PROJECT_NAME
npm install
```

### 2. Configure Environment

Copy the environment template:
```bash
cp .env_template .env
cp .env.local_template .env.local
```

Edit `.env` with your non-secret settings. Keep placeholder values like `ID_IN_ENV_LOCAL` and `SECRET_IN_ENV_LOCAL` in `.env`, and put real secrets in `.env.local`. **Minimum required for development:**

```env
NODE_ENV=development
SECURE=false
PROJECT_NAME=my_project

SERVER_IP=localhost
SERVER_PORT=80

DNS=http://localhost:5173

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

DATABASE_URL="mongodb://localhost:27017/PROJECT_NAME"
```

> Adjust `DATABASE_URL` to match your chosen database provider.

### 3. Configure Application

Copy the config template:
```bash
cp configTemplate.txt config.ts
```

### 4. Initialize Database

```bash
npx prisma generate
npx prisma db push
```

### 5. Start Development Servers

**Terminal 1 - Backend:**
```bash
npm run server
```

**Terminal 2 - Frontend:**
```bash
npm run client
```

The app is now running at:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:80`

---

## Production Build

### 1. Build Everything

```bash
npm run build
```

This runs:
1. `npm run generateArtifacts` - Generates API/Sync type maps and production route maps
2. `tsc -b && vite build` - Builds the frontend to `dist/`
3. `tsx scripts/bundleServer.ts` - Bundles the server

### 2. Build Output

After building, you'll have:
```
dist/
├── server.js          # Bundled Node.js server
├── assets/            # Frontend JS/CSS bundles
├── index.html         # Frontend entry point
└── ...
```

### 3. Run Production

```bash
npm run prod
# or
node dist/server.js
```

---

## Deployment Options

### VPS Deployment with nginx

#### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install nginx
sudo apt install -y nginx

# Install Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server

# Install PM2 for process management
sudo npm install -g pm2
```

> Install your chosen database separately (see database section above).

#### 2. Deploy Application

```bash
# Clone your repo
cd /var/www
git clone https://github.com/ItsLucky23/LuckyStack-v2 PROJECT_NAME
cd PROJECT_NAME

# Install dependencies
npm ci --production

# Build
npm run build

# Start with PM2
pm2 start dist/server.js --name PROJECT_NAME
pm2 save
pm2 startup
```

#### 3. Configure nginx

Create `/etc/nginx/sites-available/PROJECT_NAME`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL certificates (use Certbot for free certs)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Proxy to Node.js server
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support (critical for Socket.io)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/PROJECT_NAME /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

#### 5. Production Environment

Update your `.env`:

```env
NODE_ENV=production
SECURE=true
SERVER_IP=127.0.0.1
SERVER_PORT=3000
DNS=https://your-domain.com

# Use production OAuth credentials
GOOGLE_CLIENT_ID=your_prod_id
GOOGLE_CLIENT_SECRET=your_prod_secret
# ... etc
```

---

### VPS Deployment with Caddy

Caddy automatically handles SSL certificates.

#### 1. Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

#### 2. Configure Caddy

Edit `/etc/caddy/Caddyfile`:

```caddy
your-domain.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

That's it! Caddy automatically provisions SSL.

---

### Docker Deployment

#### 1. Create Dockerfile

Create `Dockerfile` in project root:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000
ENV SERVER_IP=0.0.0.0

CMD ["node", "dist/server.js"]
```

#### 2. Create docker-compose.yml

The example below uses MongoDB. Replace the `mongo` service with your chosen database.

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - DATABASE_URL=mongodb://mongo:27017/PROJECT_NAME
    depends_on:
      - redis
      - mongo
    restart: unless-stopped

  redis:
    image: redis:alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  # Replace with your chosen database
  mongo:
    image: mongo:latest
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

volumes:
  redis_data:
  mongo_data:
```

#### 3. Deploy

```bash
docker-compose up -d --build
```

---

## Environment Variables Reference

| Variable                   | Required | Default       | Description                              |
| -------------------------- | -------- | ------------- | ---------------------------------------- |
| `NODE_ENV`                 | Yes      | `development` | `development` or `production`            |
| `PROJECT_NAME`             | Yes      | -             | Unique name for Redis key prefixing      |
| `SERVER_IP`                | Yes      | `localhost`   | Server bind address                      |
| `SERVER_PORT`              | Yes      | `80`          | Server port                              |
| `DNS`                      | Yes      | -             | Public URL for OAuth redirects           |
| `SECURE`                   | Yes      | `false`       | Enable HTTPS cookies                     |
| `REDIS_HOST`               | Yes      | `127.0.0.1`   | Redis server host                        |
| `REDIS_PORT`               | Yes      | `6379`        | Redis server port                        |
| `DATABASE_URL`             | Yes      | -             | Database connection string (any Prisma-supported DB) |
| `SENTRY_DSN`               | No       | -             | Server Sentry DSN                        |
| `SENTRY_ENABLED`           | No       | `false`       | Force-enable server Sentry in development |
| `VITE_SENTRY_DSN`          | No       | -             | Client Sentry DSN                        |
| `VITE_SENTRY_ENABLED`      | No       | `false`       | Force-enable client Sentry in development |
| `GOOGLE_CLIENT_ID`         | No       | -             | Google OAuth client ID                   |
| `GOOGLE_CLIENT_SECRET`     | No       | -             | Google OAuth client secret               |
| `GITHUB_CLIENT_ID`         | No       | -             | GitHub OAuth client ID                   |
| `GITHUB_CLIENT_SECRET`     | No       | -             | GitHub OAuth client secret               |
| `DISCORD_CLIENT_ID`        | No       | -             | Discord OAuth client ID                  |
| `DISCORD_CLIENT_SECRET`    | No       | -             | Discord OAuth client secret              |
| `FACEBOOK_CLIENT_ID`       | No       | -             | Facebook OAuth client ID                 |
| `FACEBOOK_CLIENT_SECRET`   | No       | -             | Facebook OAuth client secret             |

---

## Troubleshooting

### Socket.io Connection Fails

**Symptom:** Frontend can't connect to backend, WebSocket errors in console.

**Solutions:**
1. Ensure nginx/Caddy is configured for WebSocket upgrades
2. Check `DNS` env variable matches your actual domain
3. Verify `EXTERNAL_ORIGINS` includes your domain

### OAuth Redirect Fails

**Symptom:** Login redirects to wrong URL or fails silently.

**Solutions:**
1. Check OAuth callback URLs in provider dashboard match exactly:
   - Google: `https://your-domain.com/auth/callback/google`
   - GitHub: `https://your-domain.com/auth/callback/github`
   - etc.
2. Ensure `DNS` env variable is correctly set
3. Use production OAuth credentials (not DEV_ prefixed ones)

### Redis Connection Errors

**Symptom:** Server crashes with Redis connection refused.

**Solutions:**
1. Verify Redis is running: `redis-cli ping`
2. Check `REDIS_HOST` and `REDIS_PORT` are correct
3. If using Docker, ensure services are on same network

### Session Not Persisting

**Symptom:** User gets logged out on page refresh.

**Solutions:**
1. Check `SECURE=true` only if using HTTPS
2. Verify `sessionBasedToken` in `config.ts` matches your intended token mode
3. Check Redis is properly storing data: `redis-cli keys "*"`

### Build Fails

**Symptom:** TypeScript or Vite build errors.

**Solutions:**
1. Ensure `config.ts` exists (copy from `configTemplate.txt`)
2. Run `npx prisma generate` before building
3. Check all dependencies installed: `rm -rf node_modules && npm install`

### Database Connection Issues

**Symptom:** Prisma errors on startup or API calls.

**Solutions:**
1. Verify `DATABASE_URL` in `.env` matches your database provider
2. Ensure only ONE `datasource db` block is uncommented in `prisma/schema.prisma`
3. Run `npx prisma generate` after changing providers
4. For MongoDB: ensure replica set is configured if using transactions

---

## Quick Reference

```bash
# Development
npm run client          # Start Vite dev server
npm run server          # Start Node.js server
npm run liveServer      # Start server with hot reload

# Production
npm run build           # Build everything
npm run prod            # Run production server

# Database
npx prisma generate     # Generate Prisma client
npx prisma db push      # Push schema to database
npx prisma studio       # Open database GUI
```
