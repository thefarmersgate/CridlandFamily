// Lists Ring devices using a short-lived Playground access token pasted into
// the status page, so device ids can be found before account linking works.
// The token is used for this one request and never stored or logged.
import { json, requireKiosk } from "../../lib/auth.js";

const BASE = "https://api.amazonvision.com";

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let token = "";
  try { token = String((await req.json()).token || "").trim().replace(/^Bearer\s+/i, ""); } catch {}
  if (!token) return json({ error: "token required" }, 400);

  const r = await fetch(`${BASE}/v1/devices?include=status,capabilities,location`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return json({ error: `Ring said ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);

  const body = await r.json();
  const list = body.devices || body.items || body.data || (Array.isArray(body) ? body : []);
  return json({
    devices: list.map((d) => {
      const w = d.capabilities?.video?.width ?? d.video?.width ?? null;
      const h = d.capabilities?.video?.height ?? d.video?.height ?? null;
      return {
        id: d.id || d.device_id,
        name: d.name || d.description || "(unnamed)",
        kind: d.kind || d.device_type || d.type || "",
        video: w && h ? `${w}x${h}` : null,
        aspect: w && h ? (Math.abs(w / h - 1) < 0.02 ? "1/1" : "16/9") : null,
        battery: d.status?.battery_level ?? d.battery_level ?? null,
      };
    }),
    raw: list.length ? undefined : body,
  });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
