# Glengowerie Frame

Lives at **https://cridland.net.au/shirldashboard**

A picture frame for a bench. Ring snapshots and family photos, with the time,
weather and the day's next thing readable from across the room.

No framework. Static `public/` plus plain `api/*.js` functions, zero runtime
dependencies — a deploy is seconds of build time, which is the cost centre on
this Vercel account.

---

## The domain

`cridland.net.au` is already on the team and on Vercel's nameservers.

**Project → Settings → Domains → Add `cridland.net.au`** (and `www` if you want
it). DNS is already pointed, so it verifies immediately.

The frame is then at **`/shirldashboard`**, the message form at
**`/shirldashboard/send`**, and the functions stay at `/api/*` on the same
origin — so no rewrite, no proxy hop, and nothing to go wrong with relative
paths. Other family dashboards can sit alongside it at their own paths.

## Deploy

```bash
npm i -g vercel
vercel link            # choose the existing cridland-family project
vercel --prod
```

Nothing to install, nothing to build.

## Vercel setup, once

1. **Storage → Blob store** → connect to this project. Adds `BLOB_READ_WRITE_TOKEN`.
2. **Storage → Edge Config** → connect to this project. Adds `EDGE_CONFIG`.
   Also add by hand:
   - `EDGE_CONFIG_ID` — the `ecfg_…` id
   - `VERCEL_API_TOKEN` — an account token, needed because **Edge Config writes
     go through the REST API**. This is how the rotating Ring refresh token is
     persisted; it cannot live in an env var, which is immutable at runtime.
3. Set the remaining variables from `.env.example`.

## Environment variables

| | |
|---|---|
| `RING_ID` `RING_SECRET` `RING_HMAC` | ✅ already set |
| `GOOGLE_SA_KEY` | base64 of the whole service-account JSON |
| `GCAL_ID` `GDRIVE_FOLDER_ID` | calendar and photo folder |
| `CAM_FRONT` `CAM_DRIVE` `CAM_BACK` `CAM_SHED` `CAM_BELL` | Ring device ids from `GET /v1/devices` |
| `BELL_ASPECT` | `1/1` for Doorbell Pro 2 / Elite / Battery Plus, else `16/9` |
| `CAPTURE_INTERVAL_MIN` | the Snapshot Capture interval set in the Ring app (default 30) |
| `KIOSK_KEY` `SEND_PIN` `CRON_SECRET` | generate: `openssl rand -hex 24` |

Until `GOOGLE_SA_KEY` is set the calendar and photos come back empty and
everything else runs — that is deliberate, so the frame can go on the bench
before the Google side is finished.

## Seed the Ring refresh token, once

```bash
curl -X POST https://cridland.net.au/api/seed-token \
  -H "X-Kiosk-Key: $KIOSK_KEY" -H 'Content-Type: application/json' \
  -d '{"refresh_token":"<from the Ring OAuth exchange>"}'
```

It refuses if a token is already stored, so it cannot clobber a live one.

## Point Ring at the webhook

`https://cridland.net.au/api/webhooks/ring`

Motion and doorbell events land there. The HMAC signature is the only gate, and
a **missing** signature is rejected exactly as hard as a wrong one.

## The tablet

Dell Latitude 7200 2-in-1, 12.3" **1920×1280 3:2** — set Windows scaling to
**150%**, which is the 1280×853 the layout is built for.

```
msedge.exe --kiosk https://cridland.net.au/shirldashboard ^
  --edge-kiosk-type=fullscreen --kiosk-idle-timeout-minutes=0 --no-first-run
```

`fullscreen` matters: the `public-browsing` kiosk type resets every 5 minutes
and would wipe the kiosk key out of `localStorage`.

Then: auto-login on a standard account (`netplwiz`), Task Scheduler *At log on*
with **restart on failure**, `powercfg /change monitor-timeout-ac 0` and
`standby-timeout-ac 0`, lock screen rotation, Windows Update active hours over
the waking day, and Dell's **"Primarily AC Use"** battery mode — a cell held at
100% for years swells, and in a detachable that means a bulging screen.

Enter the kiosk key once at first run.

---

## How it behaves

| | |
|---|---|
| At rest | One picture, full bleed, cycling every 15s through four cameras and the family album |
| Controls | Hidden until touched, then gone again after 30s |
| Snapshots | Read at **half** the capture interval. Never triggers a capture. |
| Live view | Only on an explicit tap. 60s cap, one session, explicit teardown. |
| Motion | That camera takes the screen for 90s; a newer event wins |
| Doorbell | Full-screen takeover with the event photo and a **Watch live** button |
| 23:00–07:00 | A dim clock. No reads at all. Doorbell still takes over; a touch brings the frame back for 60s |
| Offline | Keeps the last pictures and says so, rather than blanking |

## The two rules the code enforces

1. **Nothing triggers a Ring capture, and nothing opens a stream, without a tap.**
   The carousel serves cached images; advancing it makes no request at all.
2. **Never stretch a picture.** Every image is `object-fit: cover`, never `fill`.
   A 16:9 source on this 3:2 screen loses ~8% from each side — change `cover` to
   `contain` in `.shot` if the full field of view matters more than the look.

## Layout

```
public/index.html                   apex holding page
public/shirldashboard/index.html    the frame
public/shirldashboard/send.html     family message form
api/state.js           weather + calendar + photos + camera meta
api/snapshot/[key].js  stored Ring image, or a Drive photo
api/live/[key].js      WHEP proxy (SDP only; media is peer-to-peer)
api/webhooks/ring.js   HMAC-verified motion and doorbell
api/send.js            writes the message
api/cron/refresh.js    token rotation + device status (never images)
api/cron/warm.js       weather, calendar, photos
api/seed-token.js      one-time refresh-token seed
lib/                   ring, google, weather, store, auth, cameras
```
