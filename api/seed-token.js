// ONE-TIME: seeds the first Ring refresh token into Edge Config.
// Requires the kiosk key, and refuses once a token exists so it cannot clobber
// a live one. Safe to delete after setup.
import { requireKiosk, json } from "../lib/auth.js";
import { cfgGet, cfgSet } from "../lib/store.js";

export default async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return deny;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const force = new URL(req.url).searchParams.get("force");
  if ((await cfgGet("ring_refresh_token")) && !force) {
    return json({ error: "a refresh token is already stored; add ?force=1 to replace" }, 409);
  }
  let body = {};
  try { body = await req.json(); } catch {}
  if (!body.refresh_token) return json({ error: "refresh_token required" }, 400);

  await cfgSet("ring_refresh_token", body.refresh_token);
  return json({ ok: true });
}
