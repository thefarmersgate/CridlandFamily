// Lists Ring devices using a short-lived Playground access token pasted into
// the status page, so device ids can be found before account linking works.
// The token is used for this one request and never stored or logged.
import { json, requireKiosk } from "../../lib/auth.js";
import { normalizeDevices } from "../../lib/ring.js";

const BASE = "https://api.amazonvision.com";

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let token = "";
  try { token = String((await req.json()).token || "").trim().replace(/^Bearer\s+/i, ""); } catch {}
  if (!token) return json({ error: "token required" }, 400);

  const r = await fetch(`${BASE}/v1/devices?include=status,capabilities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return json({ error: `Ring said ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);

  const devices = normalizeDevices(await r.json());
  return json({
    devices: devices.map((d) => ({ id: d.id, name: d.name, kind: d.online === false ? "offline" : "", video: d.ratio, aspect: d.aspect })),
  });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
