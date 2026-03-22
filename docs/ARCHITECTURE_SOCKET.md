# Socket Architecture

> Socket.io-based real-time communication layer.

---

## Quick Reference

```typescript
// Client: Access socket instance
import { socket, waitForSocket } from "src/_sockets/socketInitializer";

await waitForSocket(); // Ensure connected
socket.emit("event", data);
```

---

## Core Events

| Event                 | Direction        | Purpose                      |
| --------------------- | ---------------- | ---------------------------- |
| `apiRequest`          | Client → Server  | RPC-style API calls          |
| `apiResponse-{index}` | Server → Client  | API response by index        |
| `sync`                | Client → Server  | Sync event to broadcast      |
| `sync`                | Server → Clients | Broadcasted sync payloads    |
| `joinRoom`            | Client → Server  | Join a specific room         |
| `leaveRoom`           | Client → Server  | Leave a specific room        |
| `getJoinedRooms`      | Client → Server  | Get current room membership  |
| `updateLocation`      | Client → Server  | Track user's current page    |
| `forceLogout`         | Server → Client  | Force logout (other session) |

---

## Room System

```typescript
// Server-side: socket joins room
socket.join(roomCode);

// Server-side: broadcast to room
io.to(roomCode).emit("sync", data);

// Client triggers room join
socket.emit("joinRoom", { roomCode: "game-123" });
```

Room codes are automatically extracted from URL paths:

- `/games/chess/room-abc` → room code = `room-abc`

---

## Connection State

```typescript
import { useSocketStatus } from 'src/_providers/socketStatusProvider';

function ConnectionIndicator() {
  const { connected, reconnecting } = useSocketStatus();

  if (!connected && reconnecting) return <Spinner />;
  if (!connected) return <Offline />;
  return <Online />;
}
```

---

## Activity Broadcasting

When `config.socketActivityBroadcaster = true`:

```typescript
// Other users in same room can see status
const { socketStatus } = useSocketStatus();
// socketStatus['user-id'] = { status: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTING' }
```

---

## Configuration

```typescript
// config.ts
const config = {
  backendUrl: 'http://localhost:80',
  socketActivityBroadcaster: false,  // Enable presence tracking
  locationProviderEnabled: true,     // Enable route-to-session location syncing
};

// .env
SERVER_IP=127.0.0.1
SERVER_PORT=80
```

---

## Error Handling

```typescript
socket.on("connect_error", (error) => {
  console.error("Connection failed:", error);
});

socket.on("disconnect", (reason) => {
  if (reason === "io server disconnect") {
    // Server forced disconnect - try reconnect
    socket.connect();
  }
});
```

---

## Runtime Function Reference

| File | Function | Purpose |
| ---- | -------- | ------- |
| `server/sockets/socket.ts` | `loadSocket` | Initializes Socket.io server, registers all socket event handlers. |
| `src/_sockets/socketInitializer.ts` | `useSocket` | Initializes client socket, listeners, queue flushing, visibility reconnection behavior. |
| `src/_sockets/socketInitializer.ts` | `joinRoom` / `leaveRoom` / `getJoinedRooms` | Client room management helpers. |
| `server/sockets/handleApiRequest.ts` | `default export` | Handles incoming `apiRequest` socket messages. |
| `server/sockets/handleSyncRequest.ts` | `default export` | Handles incoming `sync` socket messages and room fanout. |
