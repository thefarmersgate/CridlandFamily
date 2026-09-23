// Ring posts motion and doorbell events here. Public by necessity; the HMAC
// signature is the only gate. Ring wants HTTP 200 within 5 seconds, so:
// verify, write the pulse, return.
import { verifyRingSignature, json } from "../../lib/auth.js";
import { byRingId } from "../../lib/cameras.js";
import { blobPut, cfgSet } from "../../lib/store.js";

export default async function handler(req) {
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

  const cam = byRingId(ev.device_id);
  const pulse = {
    id: `${ev.event_type}:${ev.device_id}:${ev.timestamp}`,
    type: ev.event_type,                        // button_press | motion_detected
    camera: cam?.key ?? null,
    name: cam?.name ?? null,
    subType: ev.attributes?.sub_type ?? null,   // human | vehicle | animal
    at: ev.timestamp || Date.now(),
  };
  try {
    const put = await blobPut("pulse.json", pulse);
    if (put?.url) await cfgSet("pulse_url", put.url);
  } catch (e) { console.error("pulse write", e.message); }

  return json({ ok: true });
}
