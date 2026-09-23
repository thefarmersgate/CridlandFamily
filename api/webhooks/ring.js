// Ring posts motion and doorbell events here. Public by necessity; the HMAC
// signature is the only gate. Ring wants HTTP 200 within 5 seconds, so:
// verify, write the pulse, return.
import { verifyRingSignature, json } from "../../lib/auth.js";
import { byRingId } from "../../lib/cameras.js";
import { blobPut, cfgSet } from "../../lib/store.js";

async function handler(req) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // req.text() gives the exact bytes Ring signed. Parsing first and
  // re-serialising would not reproduce them, and the HMAC would never match.
  const raw = await req.text();
  const sig = req.headers.get("x-signature") || req.headers.get("x-ring-signature");
  if (!verifyRingSignature(raw, sig)) {
    console.warn("ring webhook: bad or missing signature");
    return json({ error: "bad signature" }, 401);
  }

  let ev;
  try { ev = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  // v1.1: { meta: { request_id, account_id }, data: { type, attributes: { source, timestamp, sub_type } } }
  const type = ev.data?.type;
  const a = ev.data?.attributes || {};
  if (type !== "button_press" && type !== "motion_detected") {
    // Lifecycle events (device_added, app_integration_added, ...) need no
    // action here. Always 200: repeated 4xx makes Ring disable the webhook.
    console.log("ring webhook:", type);
    return json({ ok: true });
  }

  const cam = byRingId(a.source);
  const pulse = {
    id: ev.meta?.request_id || `${type}:${a.source}:${a.timestamp}`,
    type,                                       // button_press | motion_detected
    camera: cam?.key ?? null,
    name: cam?.name ?? null,
    subType: a.sub_type ?? null,                // human | vehicle | motion | other_motion
    at: a.timestamp || Date.now(),
  };
  try {
    const put = await blobPut("pulse.json", pulse);
    if (put?.url) await cfgSet("pulse_url", put.url);
  } catch (e) { console.error("pulse write", e.message); }

  return json({ ok: true });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
