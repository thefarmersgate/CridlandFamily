// Finishes one-way account linking: the user has signed in (setup key), so
// check the nonce is fresh and matches the unclaimed tokens, then tell Ring
// (POST nonce, PATCH completed) and promote the refresh token to live use.
import { createHmac, timingSafeEqual } from "node:crypto";
import { json, requireKiosk } from "../../lib/auth.js";
import { cfgGet, cfgSet, cfgDelete } from "../../lib/store.js";
import { REFRESH_KEY, refreshWith, confirmLink } from "../../lib/ring.js";

const WINDOW_MS = 600 * 1000;

// base64url(HMAC-SHA256(key, "<time>:<account_id>")), no padding.
const nonceFor = (time, accountId) =>
  createHmac("sha256", process.env.RING_HMAC).update(`${time}:${accountId}`).digest("base64url");

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

async function handler(req) {
  const deny = requireKiosk(req);
  if (deny) return json({ error: "That setup key was not accepted." }, 401);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body = {};
  try { body = await req.json(); } catch {}
  const { nonce, time } = body;
  const age = Date.now() - Number(time);
  if (!nonce || !Number.isFinite(age) || age < 0 || age > WINDOW_MS) {
    return json({ error: "This link has expired. Start again from Ring." }, 400);
  }

  const pending = await cfgGet("ring_pending");
  if (!pending?.refresh) {
    return json({ error: "Ring has not sent its tokens yet. Start again from Ring." }, 409);
  }
  if (!same(nonceFor(time, pending.accountId), nonce)) {
    console.warn("ring claim: nonce did not match the pending account");
    return json({ error: "This link does not match. Start again from Ring." }, 400);
  }

  try {
    // Refresh first: it proves the token works and rotates it.
    // The old refresh token dies on use, so keep the new one pending until
    // Ring accepts the link; a failed confirm can then be retried.
    const t = await refreshWith(pending.refresh);
    await cfgSet("ring_pending", { ...pending, refresh: t.refresh_token });
    await confirmLink(t.access_token, nonce, "f***e@cridland.net.au");
    await cfgSet(REFRESH_KEY, t.refresh_token);
    await cfgSet("ring_account_id", pending.accountId);
    // Media is only released from consent onwards; snapshots start here.
    await cfgSet("ring_linked_at", Date.now());
    await cfgDelete("ring_pending");
    console.log("ring claim: linked", { accountId: pending.accountId });
    return json({ ok: true });
  } catch (e) {
    console.error("ring claim:", e.message);
    return json({ error: "Ring did not accept the link. Try again." }, 502);
  }
}

// Web-standard signature: Vercel passes a Request and expects a Response.
export default { fetch: handler };
