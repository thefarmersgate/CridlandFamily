// Setup checklist for /shirldashboard/status. Reports which settings are
// present and whether the stores answer - never the values themselves.
import { requireKiosk, json } from "../lib/auth.js";
import { cfgGet } from "../lib/store.js";

const has = (k) => !!process.env[k];

async function probe(fn) {
  try { return await fn(); } catch (e) { return { ok: false, note: e.message }; }
}

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;

  const [edgeRead, edgeWrite, blob, ringSeed, google] = await Promise.all([
    probe(async () => {
      if (!has("EDGE_CONFIG")) return { ok: false, note: "EDGE_CONFIG not set" };
      await cfgGet("ring_refresh_token");
      return { ok: true };
    }),
    // A read of the store's metadata proves the id and token pair can reach it,
    // without writing anything.
    probe(async () => {
      if (!has("EDGE_CONFIG_ID") || !has("VERCEL_API_TOKEN")) {
        return { ok: false, note: "EDGE_CONFIG_ID and VERCEL_API_TOKEN both needed" };
      }
      const r = await fetch(`https://api.vercel.com/v1/edge-config/${process.env.EDGE_CONFIG_ID}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` },
      });
      return r.ok ? { ok: true } : { ok: false, note: `Vercel said ${r.status}` };
    }),
    probe(async () => {
      if (!has("BLOB_READ_WRITE_TOKEN")) return { ok: false, note: "BLOB_READ_WRITE_TOKEN not set" };
      const r = await fetch("https://blob.vercel-storage.com?limit=1", {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`, "x-api-version": "7" },
      });
      return r.ok ? { ok: true } : { ok: false, note: `Blob said ${r.status}` };
    }),
    probe(async () => {
      if (!has("EDGE_CONFIG")) return { ok: false, note: "needs Edge Config first" };
      return (await cfgGet("ring_refresh_token")) ? { ok: true } : { ok: false, note: "not seeded yet" };
    }),
    probe(async () => {
      if (!has("GOOGLE_SA_KEY")) return { ok: false, note: "not set" };
      const j = JSON.parse(Buffer.from(process.env.GOOGLE_SA_KEY, "base64").toString("utf8"));
      return j.client_email && j.private_key
        ? { ok: true, note: j.client_email }
        : { ok: false, note: "not a service-account key" };
    }),
  ]);

  const env = Object.fromEntries([
    "KIOSK_KEY", "SEND_PIN", "CRON_SECRET",
    "BLOB_READ_WRITE_TOKEN", "EDGE_CONFIG", "EDGE_CONFIG_ID", "VERCEL_API_TOKEN",
    "RING_ID", "RING_SECRET", "RING_HMAC",
    "CAM_FRONT", "CAM_DRIVE", "CAM_BACK", "CAM_SHED", "CAM_BELL",
    "GOOGLE_SA_KEY", "GCAL_ID", "GDRIVE_FOLDER_ID",
  ].map((k) => [k, has(k)]));

  return json({ env, checks: { edgeRead, edgeWrite, blob, ringSeed, google } });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
