import { requireKiosk, json } from "../lib/auth.js";
import { weather, describe } from "../lib/weather.js";
import { calendar, photos, googleConfigured } from "../lib/google.js";
import { CAMERAS, DOORBELL, STALE_MIN, CAPTURE_INTERVAL_MIN } from "../lib/cameras.js";
import { cfgGet } from "../lib/store.js";

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;

  const [wx, cal, pics, snapMeta, pulseUrl, msgUrl] = await Promise.allSettled([
    weather(), calendar(), photos(),
    cfgGet("snapshot_meta"), cfgGet("pulse_url"), cfgGet("message_url"),
  ]);
  const val = (r, f) => (r.status === "fulfilled" && r.value != null ? r.value : f);
  const meta = val(snapMeta, {}) || {};
  const w = val(wx, null);

  return json({
    serverTime: new Date().toISOString(),
    tz: process.env.TZ_NAME || "Australia/Adelaide",
    quietHours: { start: 23, end: 7 },
    captureIntervalMin: CAPTURE_INTERVAL_MIN,
    staleAfterMin: STALE_MIN,
    cameras: CAMERAS.map((c) => ({
      key: c.key, name: c.name, aspect: c.aspect,
      configured: !!c.ringId,
      capturedAt: meta[c.key]?.capturedAt ?? null,
      battery: meta[c.key]?.battery ?? null,
      online: meta[c.key]?.online !== false,
    })),
    doorbell: { key: DOORBELL.key, name: DOORBELL.name, aspect: DOORBELL.aspect, configured: !!DOORBELL.ringId },
    weather: w && { ...w, now: { ...w.now, text: describe(w.now.code) } },
    calendar: val(cal, []),
    photos: val(pics, []),
    google: googleConfigured(),
    // The kiosk polls these CDN urls directly every 2s, so the doorbell path
    // costs no function invocations at all.
    pulseUrl: val(pulseUrl, null),
    messageUrl: val(msgUrl, null),
  });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
