import { checkPin, json } from "../lib/auth.js";
import { blobPut, cfgSet } from "../lib/store.js";

const MAX_AGE_H = 12;

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body = {};
  try { body = await req.json(); } catch { /* fall through to validation */ }

  if (!checkPin(body.pin)) return json({ error: "Wrong PIN" }, 401);
  const who = String(body.who || "").trim().slice(0, 24);
  const text = String(body.text || "").trim().slice(0, 180);
  if (!who || !text) return json({ error: "Name and message are both needed" }, 400);

  try {
    const put = await blobPut("message.json", { who, text, at: Date.now(), expiresAt: Date.now() + MAX_AGE_H * 3600e3 });
    if (put?.url) await cfgSet("message_url", put.url);
    return json({ ok: true });
  } catch (e) {
    console.error("send", e.message);
    return json({ error: "Could not reach the frame. Try again." }, 502);
  }
}
