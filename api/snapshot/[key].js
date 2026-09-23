// Serves the latest image Ring ALREADY HOLDS. Never triggers a capture (D3a).
import { requireKiosk, json, routeKey } from "../../lib/auth.js";
import { byKey, CAPTURE_INTERVAL_MIN } from "../../lib/cameras.js";
import { snapshot } from "../../lib/ring.js";
import { photoBytes } from "../../lib/google.js";

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;
  const key = routeKey(req);

  if (key.startsWith("photo:")) {
    const got = await photoBytes(key.slice(6));
    if (!got) return json({ error: "not found" }, 404);
    return new Response(got.buffer, {
      headers: { "Content-Type": got.contentType, "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  }

  const cam = byKey(key);
  if (!cam?.ringId) return json({ error: "unknown camera" }, 404);

  try {
    const got = await snapshot(cam.ringId);
    if (!got) return json({ error: "no snapshot yet" }, 503);
    // Half the capture interval - fresh enough, and never asks twice for the
    // same picture.
    const sMax = Math.floor((CAPTURE_INTERVAL_MIN * 60) / 2);
    const headers = {
      "Content-Type": got.contentType,
      "Cache-Control": `public, s-maxage=${sMax}, stale-while-revalidate=${sMax * 4}`,
    };
    if (got.capturedAt) headers["X-Captured-At"] = String(got.capturedAt);
    return new Response(got.buffer, { headers });
  } catch (e) {
    console.error("snapshot", cam.key, e.message);
    return json({ error: "ring unavailable" }, 502);
  }
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
