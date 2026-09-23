// Ring's Token Exchange URL (one-way account linking, step 4). After consent
// Ring POSTs a one-time authorization code here; it must be swapped for tokens
// within 60 seconds. The tokens are held as UNCLAIMED, keyed by Ring Account
// ID, until someone signs in on the Account Link page and the nonce matches.
//
// The body shape is not pinned down in the docs, so the code is read from
// JSON, a form body or the query string - whichever carries it.
import { json } from "../../lib/auth.js";
import { cfgSet } from "../../lib/store.js";
import { exchangeCode, usersMe } from "../../lib/ring.js";

async function readParams(req) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (req.method === "POST") {
    const raw = await req.text();
    try { Object.assign(p, JSON.parse(raw)); }
    catch { Object.assign(p, Object.fromEntries(new URLSearchParams(raw))); }
  }
  return p;
}

async function handler(req) {
  const p = await readParams(req);
  const code = p.code || p.authorization_code || p.auth_code;
  console.log("ring link: received", { method: req.method, keys: Object.keys(p) });
  if (!code) return json({ error: "code required" }, 400);

  try {
    const t = await exchangeCode(code);
    const accountId = await usersMe(t.access_token);
    // One household, so one pending slot; a newer install replaces an older one.
    await cfgSet("ring_pending", { accountId, refresh: t.refresh_token, at: Date.now() });
    console.log("ring link: tokens held unclaimed", { accountId });
    return json({ ok: true });
  } catch (e) {
    console.error("ring link:", e.message);
    return json({ error: "exchange failed" }, 502);
  }
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
