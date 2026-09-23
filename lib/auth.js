import { timingSafeEqual, createHmac } from "node:crypto";

function safeEq(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

/** Returns null when allowed, or a 401 Response. */
export function requireKiosk(req) {
  const key = req.headers.get("x-kiosk-key");
  if (!process.env.KIOSK_KEY || !safeEq(key, process.env.KIOSK_KEY)) {
    return json({ error: "unauthorised" }, 401);
  }
  return null;
}

/** Vercel sends Authorization: Bearer $CRON_SECRET on scheduled invocations. */
export function requireCron(req) {
  const got = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || !safeEq(got, process.env.CRON_SECRET)) {
    return json({ error: "unauthorised" }, 401);
  }
  return null;
}

export const checkPin = (pin) => !!process.env.SEND_PIN && safeEq(pin, process.env.SEND_PIN);

/** HMAC-SHA256 over the RAW body. A missing signature fails exactly like a wrong one. */
export function verifyRingSignature(rawBody, signature) {
  if (!signature || !process.env.RING_HMAC) return false;
  const mac = createHmac("sha256", process.env.RING_HMAC).update(rawBody).digest("hex");
  return safeEq(mac, String(signature).replace(/^sha256=/i, ""));
}

/** Last path segment, for [key] routes. */
export const routeKey = (req) => {
  const p = new URL(req.url).pathname.replace(/\/+$/, "");
  return decodeURIComponent(p.slice(p.lastIndexOf("/") + 1));
};
