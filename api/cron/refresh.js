// Keeps the Ring access token warm and rotates the refresh token before it can
// lapse. Lazy refresh in lib/ring.js is the safety net; this is the primary path.
import { requireCron, json } from "../../lib/auth.js";
import { accessToken, deviceStatus, batteryOf } from "../../lib/ring.js";
import { CAMERAS, DOORBELL, LOW_BATTERY_PCT } from "../../lib/cameras.js";
import { cfgGet, cfgSet } from "../../lib/store.js";

async function handler(req) {
  const deny = requireCron(req);
  if (deny) return deny;
  const out = { token: "skipped", status: {} };

  try { await accessToken(); out.token = "ok"; }
  catch (e) { out.token = `failed: ${e.message}`; console.error("token refresh", e.message); }

  // Status only - never an image. This is what notices a camera that died
  // overnight, without ever waking one.
  const meta = (await cfgGet("snapshot_meta")) || {};
  for (const c of [...CAMERAS, DOORBELL]) {
    if (!c.ringId) continue;
    try {
      const s = await deviceStatus(c.ringId);
      const online = s ? s.online !== false : false;
      const battery = batteryOf(s);
      meta[c.key] = { ...(meta[c.key] || {}), online, battery, checkedAt: Date.now() };
      out.status[c.key] = { online, battery };
      if (battery !== null && battery <= LOW_BATTERY_PCT) console.warn(`LOW BATTERY ${c.name}: ${battery}%`);
    } catch (e) { out.status[c.key] = `err: ${e.message}`; }
  }
  try { await cfgSet("snapshot_meta", meta); } catch (e) { console.error("meta write", e.message); }

  return json(out);
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
