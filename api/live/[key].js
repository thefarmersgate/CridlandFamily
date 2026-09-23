// WHEP proxy - reached only from an explicit tap.
// The SDP exchange passes through here; the MEDIA does not. It flows
// peer-to-peer between the browser and Ring, which is why this works on
// serverless at all.
import { requireKiosk, json, routeKey } from "../../lib/auth.js";
import { byKey } from "../../lib/cameras.js";
import { whepStart, whepStop } from "../../lib/ring.js";

export default async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;
  const cam = byKey(routeKey(req));
  if (!cam?.ringId) return json({ error: "unknown camera" }, 404);

  if (req.method === "POST") {
    try {
      const offer = await req.text();
      if (!offer.includes("v=0")) return json({ error: "not an SDP offer" }, 400);
      const { sdpAnswer, sessionId } = await whepStart(cam.ringId, offer);
      const headers = { "Content-Type": "application/sdp", "Cache-Control": "no-store" };
      if (sessionId) headers["Location"] = `/api/live/${cam.key}?session=${sessionId}`;
      return new Response(sdpAnswer, { status: 201, headers });
    } catch (e) {
      console.error("whep start", cam.key, e.message);
      return json({ error: "could not start live view" }, 502);
    }
  }

  if (req.method === "DELETE") {
    const session = new URL(req.url).searchParams.get("session");
    if (!session) return json({ error: "session required" }, 400);
    // Teardown is best-effort - never block the UI on it.
    try { await whepStop(cam.ringId, session); } catch (e) { console.error("whep stop", e.message); }
    return new Response(null, { status: 204 });
  }

  return json({ error: "method not allowed" }, 405);
}
