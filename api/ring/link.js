// Ring's Token Exchange URL. When the app is installed from the Ring console,
// Ring sends a one-time authorization code here; it must be swapped for tokens
// within 60 seconds. The refresh token is what keeps the frame signed in.
//
// The body shape is not pinned down in the public docs, so the code is read
// from JSON, a form body or the query string - whichever carries it.
//
// Refuses to replace a stored token unless the kiosk key is sent with
// ?force=1, so nobody else can re-point the frame at their own Ring account.
import { json, requireKiosk } from "../../lib/auth.js";
import { cfgGet, cfgSet } from "../../lib/store.js";
import { TOKEN_URL, REFRESH_KEY } from "../../lib/ring.js";

async function readParams(req) {
  const url = new URL(req.url);
  const p = Object.fromEntries(url.searchParams);
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
  const accountId = p.account_id || p.accountId || null;
  console.log("ring link: received", { method: req.method, keys: Object.keys(p), accountId });
  if (!code) return json({ error: "code required" }, 400);

  if (await cfgGet(REFRESH_KEY)) {
    if (new URL(req.url).searchParams.get("force") !== "1" || requireKiosk(req)) {
      console.warn("ring link: refused, a refresh token is already stored");
      return json({ error: "already linked" }, 409);
    }
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.RING_ID,
    client_secret: process.env.RING_SECRET,
  });
  if (p.code_verifier) body.set("code_verifier", p.code_verifier);
  if (p.redirect_uri) body.set("redirect_uri", p.redirect_uri);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error("ring link: exchange failed", r.status, detail.slice(0, 300));
    return json({ error: "exchange failed", status: r.status }, 502);
  }
  const j = await r.json();
  if (!j.refresh_token) {
    console.error("ring link: no refresh_token in response", Object.keys(j));
    return json({ error: "no refresh token returned" }, 502);
  }

  await cfgSet(REFRESH_KEY, j.refresh_token);
  if (accountId) await cfgSet("ring_account_id", String(accountId));
  console.log("ring link: linked", { accountId, expiresIn: j.expires_in });
  return json({ ok: true });
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
