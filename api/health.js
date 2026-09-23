// Setup checklist for /shirldashboard/status. Reports which settings are
// present and whether the stores answer - never the values themselves.
import { requireKiosk, json } from "../lib/auth.js";
import { cfgGet, edgeConfigApi } from "../lib/store.js";
import { creds, calendar, photos } from "../lib/google.js";
import { listDevices, normalizeDevices, deviceStatus, deviceResource, batteryOf } from "../lib/ring.js";

const has = (k) => !!process.env[k];

async function probe(fn) {
  try { return await fn(); } catch (e) { return { ok: false, note: e.message }; }
}

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;

  const [edgeRead, edgeWrite, blob, ringSeed, google] = await Promise.all([
    probe(async () => {
      if (!has("EDGE_CONFIG") && !(has("EDGE_CONFIG_ID") && has("VERCEL_API_TOKEN"))) {
        return { ok: false, note: "needs EDGE_CONFIG, or EDGE_CONFIG_ID with VERCEL_API_TOKEN" };
      }
      await cfgGet("ring_refresh_token");
      return { ok: true, note: has("EDGE_CONFIG") ? "via connection string" : "via API" };
    }),
    // A read of the store's metadata proves the id and token pair can reach it,
    // without writing anything.
    probe(async () => {
      if (!has("EDGE_CONFIG_ID") || !has("VERCEL_API_TOKEN")) {
        return { ok: false, note: "EDGE_CONFIG_ID and VERCEL_API_TOKEN both needed" };
      }
      const r = await fetch(edgeConfigApi(process.env.EDGE_CONFIG_ID).replace("%s", ""), {
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
      return (await cfgGet("ring_refresh_token")) ? { ok: true } : { ok: false, note: "not seeded yet" };
    }),
    probe(async () => {
      if (!has("GOOGLE_SA_KEY")) return { ok: false, note: "not set" };
      const j = creds();
      return j.client_email && j.private_key
        ? { ok: true, note: j.client_email }
        : { ok: false, note: "not a service-account key" };
    }),
  ]);

  // With a valid key, actually read the calendar and the photo folder so a
  // missing share shows up here rather than as an empty frame.
  let gcal = { ok: false, note: "needs the service-account key" };
  let gdrive = { ok: false, note: "needs the service-account key" };
  if (google.ok) {
    [gcal, gdrive] = await Promise.all([
      probe(async () => {
        if (!has("GCAL_ID")) return { ok: false, note: "GCAL_ID not set" };
        const ev = await calendar();
        return { ok: true, note: `${ev.length} event${ev.length === 1 ? "" : "s"} in the next 60 days` };
      }),
      probe(async () => {
        if (!has("GDRIVE_FOLDER_ID")) return { ok: false, note: "GDRIVE_FOLDER_ID not set" };
        const ph = await photos(60);
        return ph.length
          ? { ok: true, note: `${ph.length} photo${ph.length === 1 ? "" : "s"} found` }
          : { ok: false, note: "folder readable but no photos in it (or not shared with the service account)" };
      }),
    ]);
  }

  // Once Ring is linked, list the devices so their ids can be copied into the
  // CAM_* settings. One API call, only when this page is opened.
  let devices = null;
  if (ringSeed.ok) {
    try {
      const list = normalizeDevices(await listDevices());
      // Battery comes from each device's status; say plainly when Ring omits it.
      const bat = await Promise.all(list.map((d) => deviceStatus(d.id).then(batteryOf).catch(() => null)));
      // Where no battery is found, list the field names Ring does send (names
      // only) so a differently-named battery field can be spotted.
      const shape = await Promise.all(list.map(async (d, i) => {
        if (bat[i] != null) return "";
        const [st, cap] = await Promise.all([deviceResource(d.id, "status"), deviceResource(d.id, "capabilities")]);
        const keys = (o) => Object.keys(o || {}).join(",") || "none";
        return ` · status fields: ${keys(st)} · capability fields: ${keys(cap)}` +
          (cap?.battery_status ? ` · battery_status: ${JSON.stringify(cap.battery_status)}` : "");
      }));
      devices = list.map((d, i) => ({
        id: d.id, name: d.name,
        kind: [d.ratio, d.online ? "online" : "offline", bat[i] != null ? `battery ${bat[i]}%` : "battery not reported"]
          .filter(Boolean).join(" · ") + shape[i],
      }));
    } catch (e) { devices = { error: e.message }; }
  }

  // Check each CAM_* id: right shape, and (once linked) one of the account's
  // real devices. The status page shows the result against each camera row.
  const known = Array.isArray(devices) ? new Map(devices.map((d) => [d.id, d.name])) : null;
  const cams = Object.fromEntries(["CAM_FRONT", "CAM_DRIVE", "CAM_BACK", "CAM_SHED", "CAM_BELL"].map((k) => {
    const v = (process.env[k] || "").trim();
    if (!v) return [k, { ok: false, note: `${k} · not set` }];
    if (!v.startsWith("ava1.ring.device.")) {
      return [k, { ok: false, note: `${k} · not a Ring partner id (should start ava1.ring.device.)` }];
    }
    if (!known) return [k, { ok: false, note: `${k} · set, but can't be checked until Ring is linked` }];
    return known.has(v)
      ? [k, { ok: true, note: `${k} · matches "${known.get(v)}"` }]
      : [k, { ok: false, note: `${k} · not one of your linked Ring devices` }];
  }));

  const env = Object.fromEntries([
    "KIOSK_KEY", "SEND_PIN", "CRON_SECRET",
    "BLOB_READ_WRITE_TOKEN", "EDGE_CONFIG", "EDGE_CONFIG_ID", "VERCEL_API_TOKEN",
    "RING_ID", "RING_SECRET", "RING_HMAC",
    "CAM_FRONT", "CAM_DRIVE", "CAM_BACK", "CAM_SHED", "CAM_BELL",
    "GOOGLE_SA_KEY", "GCAL_ID", "GDRIVE_FOLDER_ID",
  ].map((k) => [k, has(k)]));

  return json({ env, devices, checks: { edgeRead, edgeWrite, blob, ringSeed, google, gcal, gdrive, ...cams } });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
