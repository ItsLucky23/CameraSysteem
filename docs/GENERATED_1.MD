# Smart Camera Platform Spec (LuckyStack-v2)

## 1. Doel
Dit document is de technische single source of truth voor een multi-camera platform op basis van LuckyStack-v2.

V1 focus:
- Google login en sessiebeheer.
- Realtime camera preview en bediening.
- Sync van camera state naar alle clients die dezelfde camera bekijken.
- Race-condition preventie bij gelijktijdige bediening.
- Admin-dashboard voor camera-permissies per gebruiker.

## 2. Kernbeslissing Transport
Video streaming mag niet via Socket.io lopen.

Definitieve keuze:
- Video pad: Pi5 naar website via WebRTC.
- Control en state pad: LuckyStack API plus Sync (Socket.io).

Concreet betekent dit:
- Socket.io wordt alleen gebruikt voor commands, status-updates, presence, locks en UI-sync.
- WebRTC wordt gebruikt voor live preview met lage latency.
- Bij uitval van WebRTC blijft controlkanaal actief voor beheer en foutmeldingen.

## 3. High-level Architectuur

### 3.1 Device laag
- Camera nodes (Pi Zero 2W) leveren video en telemetry aan Pi5.
- Pi5 fungeert als centrale backend, command gateway en opname coordinator.

### 3.2 Streaming laag
- WebRTC pipeline van Pi5 naar browser clients.
- Signaling en stream lifecycle management via backend endpoints en/of signaling service.
- Socket.io nooit gebruiken voor raw videoframes.

### 3.3 App laag (LuckyStack)
- React frontend met file-based routing.
- API routes voor mutaties en autorisatiechecks.
- Sync routes voor room-broadcasts van camera updates.
- Redis sessies en room membership.

## 4. Auth en Autorisatie

### 4.1 Login
- Login pagina met Google OAuth.
- Bestaande LuckyStack auth flow wordt hergebruikt.

### 4.2 Rollen
- Admin: mag gebruikers beheren en camera-toegang toekennen.
- User: alleen camera previews/controls waarvoor expliciet toegang is gegeven.

### 4.3 Camera permissies per gebruiker
Per gebruiker wordt per camera vastgelegd of preview toegestaan is.

Voorbeeld:
- Gebruiker 1: camera 1 en 3.
- Gebruiker 2: camera 2 en 3.

Autorisatieregels:
- Zonder permission geen camera preview URL/token en geen room join voor die camera.
- Zonder permission geen camera commands (pan/tilt/IR/record).
- Admin kan permissies direct wijzigen vanuit dashboard.

## 5. Permission Model (V1)

### 5.1 Datamodel (concept)
- User (bestaat al, inclusief admin flag).
- Camera.
- CameraAccess:
  - userId
  - cameraId
  - canPreview (bool)
  - canControl (bool, optioneel in V1 meteen meenemen)
  - grantedBy
  - createdAt
  - updatedAt

### 5.2 API use-cases
- getCameraListForUser: retourneert alleen camera's met toegang.
- getCameraPreviewSession: geeft WebRTC/signaling toegang alleen bij permission.
- updateCameraAccess (admin only): koppel/ontkoppel user-camera toegang.
- getUserCameraAccessMatrix (admin only): matrix voor dashboard UI.

### 5.3 Sync use-cases
- cameraAccessUpdated: push naar clients wanneer admin permissies wijzigt.
- userForcedLeaveCameraRoom: push wanneer toegang wordt ingetrokken terwijl user kijkt.

## 6. Realtime State Sync per Camera
Room conventie:
- camera-{cameraId}

Voor elke camera in een room worden gesynct:
- online/offline status
- pan/tilt positie
- IR mode en status
- recording state
- motion events
- temperatuur en safety status

Frontend gedrag:
- Bij openen camera-detail: joinRoom(camera-{cameraId}).
- Bij sluiten/navigeren: leaveRoom(camera-{cameraId}).
- UI state komt uit API bootstrap + Sync deltas.

## 7. Race Condition Preventie (Command Locking)
Probleem:
- Twee clients klikken tegelijk op dezelfde controlactie.

V1 oplossing:
- Server-authoritative locking per camera + actie.
- Redis lock key, voorbeeld: lock:camera:{cameraId}:action:{actionName}.
- TTL standaard 3 seconden (configurabel).

Flow:
1. Client stuurt command.
2. Server checkt lock.
3. Geen lock: command accepteren, lock zetten, command uitvoeren, sync broadcasten.
4. Wel lock: command rejecten met cooldownRemaining.
5. Frontend disablet knop tot lock expiry.

Aanvullend:
- Idempotency key per command om retries veilig te maken.
- Rate limiting op API/sync niveau om spam te beperken.

## 8. Componentlijst (V1)

### 8.1 Pagina's
- /login
- /cameras
- /cameras/{cameraId}
- /admin/camera-access

### 8.2 UI componenten
- CameraGridPage
- CameraCard
- CameraDetailPanel
- CameraPreviewWebRTC
- PTZControlPad
- IRModeSelector
- RecordToggle
- CameraStatusBadges
- CommandCooldownIndicator
- MotionEventList
- CameraAccessMatrix (admin)
- UserAccessEditorModal (admin)

### 8.3 Bestaande LuckyStack componenten die hergebruikt worden
- LoginForm
- Middleware
- Dropdown
- ConfirmMenu
- TemplateProvider
- MenuHandler

## 9. Route en Code-structuur (LuckyStack patroon)
Voorbeeldstructuur:

- src/cameras/page.tsx
- src/cameras/_api/getCameraList_v1.ts
- src/cameras/_api/getCameraPreviewSession_v1.ts
- src/cameras/_api/executeCameraCommand_v1.ts
- src/cameras/_sync/cameraStateUpdated_server_v1.ts
- src/cameras/_sync/cameraStateUpdated_client_v1.ts
- src/admin/camera-access/page.tsx
- src/admin/camera-access/_api/updateCameraAccess_v1.ts
- src/admin/camera-access/_api/getUserCameraAccessMatrix_v1.ts

## 10. Security en Safety
- Auth verplicht op alle camera API/sync handlers.
- Extra admin-check op permissiebeheer APIs.
- Geen stream URL's/token delen zonder permission check.
- Session invalidation en force-logout moeten toegang direct intrekken.
- Thermal safety: bij oververhitting camera automatisch naar veilige mode, inclusief sync event naar UI.

## 11. V1 Definition of Done
V1 is gereed als:
- Google login werkt stabiel.
- Video preview loopt via WebRTC en niet via Socket.io.
- Gebruiker ziet alleen camera's waarvoor toegang is verleend.
- Admin kan per gebruiker per camera toegang beheren.
- Commands zijn beschermd tegen race conditions via lock/cooldown.
- Alle clients in dezelfde camera room ontvangen consistente state updates.

## 12. V2 Roadmap
- Pre-record buffer (circular) op Pi5.
- Fijnmazige rechten (preview versus control versus admin per camera).
- Audit trail voor access changes en commands.
- Smart automation rules (tijdschema, motion zones, IR profielen).
- Multi-site beheer met camera groepen.
- Opname timeline met event overlays.
