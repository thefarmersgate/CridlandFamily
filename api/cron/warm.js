// Pre-warms weather, calendar and the photo list so /api/state is a cheap read.
// Touches Ring not at all.
import { requireCron, json } from "../../lib/auth.js";
import { weather } from "../../lib/weather.js";
import { calendar, photos, googleConfigured } from "../../lib/google.js";

async function handler(req) {
  const deny = requireCron(req);
  if (deny) return deny;
  const out = {};
  const run = async (name, fn) => {
    try { const v = await fn(); out[name] = Array.isArray(v) ? v.length : "ok"; }
    catch (e) { out[name] = `failed: ${e.message}`; console.error(name, e.message); }
  };
  await run("weather", weather);
  if (googleConfigured()) { await run("calendar", calendar); await run("photos", photos); }
  else out.google = "not configured yet";
  return json(out);
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
