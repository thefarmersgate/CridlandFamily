// Ring Partner API. https://api.amazonvision.com
//
// Rules this module enforces, from the spec:
//   D3a  Never trigger a capture. Never open a stream except on an explicit tap.
//   A1   Reads only; the carousel triggers nothing.
//   A24  Honour Retry-After on 429; never a fixed sleep.
//   §5.4 The refresh token ROTATES - always write the new one back.

import { cfgGet, cfgSet, memGet, memSet } from "./store.js";

const BASE = "https://api.amazonvision.com";
const TOKEN_URL = `${BASE}/v1/oauth/token`;
const REFRESH_KEY = "ring_refresh_token";
const SKEW_MS = 5 * 60 * 1000;

let inflight = null; // single-flight lock

/** Access tokens last ~4h. Refresh tokens last ~30 days and rotate on use. */
export async function accessToken() {
  const cached = memGet("ring_at", 3.5 * 60 * 60 * 1000);
  if (cached && cached.expiresAt - Date.now() > SKEW_MS) return cached.token;
  if (inflight) return inflight;

  inflight = (async () => {
    const refresh = await cfgGet(REFRESH_KEY);
    if (!refresh) throw new Error("no ring_refresh_token in Edge Config - run the one-time seed");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: process.env.RING_ID,
      client_secret: process.env.RING_SECRET,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw new Error(`ring token refresh: ${r.status} ${await r.text()}`);
    const j = await r.json();

    // If Ring rotated the refresh token, persisting it is not optional:
    // miss this once and the dashboard dies at the next refresh.
    if (j.refresh_token && j.refresh_token !== refresh) {
      await cfgSet(REFRESH_KEY, j.refresh_token);
    }
    const expiresAt = Date.now() + (j.expires_in ?? 14400) * 1000;
    memSet("ring_at", { token: j.access_token, expiresAt });
    return j.access_token;
  })().finally(() => { inflight = null; });

  return inflight;
}

async function ringFetch(path, init = {}, attempt = 0) {
  const token = await accessToken();
  const r = await fetch(path.startsWith("http") ? path : BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });

  if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
    if (attempt >= 4) return r;
    const ra = Number(r.headers.get("retry-after"));
    const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(2 ** attempt * 500, 8000);
    await new Promise((s) => setTimeout(s, waitMs));
    return ringFetch(path, init, attempt + 1);
  }
  const left = r.headers.get("x-ratelimit-remaining");
  if (left !== null && Number(left) < 20) console.warn("ring rate limit low:", left);
  return r;
}

export async function listDevices() {
  const r = await ringFetch("/v1/devices?include=status,capabilities,location");
  if (!r.ok) throw new Error(`listDevices: ${r.status}`);
  return r.json();
}

export async function deviceStatus(id) {
  const r = await ringFetch(`/v1/devices/${encodeURIComponent(id)}/status`);
  if (!r.ok) return null;
  return r.json();
}

/**
 * READ the latest stored snapshot. This must not cause a capture (D3a).
 * Confirm in the spike; if this endpoint turns out to trigger one, stop and
 * find the read-only path before anything else is built on it.
 */
export async function snapshot(id) {
  const r = await ringFetch(`/v1/devices/${encodeURIComponent(id)}/media/image/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "jpeg" }),
  });
  if (!r.ok) return null;

  const ct = r.headers.get("content-type") || "";
  // Some deployments answer with a signed URL rather than bytes.
  if (ct.includes("application/json")) {
    const j = await r.json();
    const url = j.url || j.download_url || j.media_url;
    if (!url) return null;
    const img = await fetch(url);
    if (!img.ok) return null;
    return {
      buffer: Buffer.from(await img.arrayBuffer()),
      contentType: img.headers.get("content-type") || "image/jpeg",
      capturedAt: j.captured_at || j.timestamp || null,
    };
  }
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    contentType: ct || "image/jpeg",
    capturedAt: r.headers.get("x-captured-at") || null,
  };
}

/** WHEP. Only ever called from an explicit tap. Media is peer-to-peer. */
export async function whepStart(id, sdpOffer) {
  const r = await ringFetch(`/v1/devices/${encodeURIComponent(id)}/media/streaming/whep/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: sdpOffer,
  });
  if (!r.ok) throw new Error(`whepStart: ${r.status} ${await r.text()}`);
  const loc = r.headers.get("location") || "";
  return { sdpAnswer: await r.text(), sessionId: loc.split("/").pop() || null, location: loc };
}

export async function whepStop(id, sessionId) {
  await ringFetch(
    `/v1/devices/${encodeURIComponent(id)}/media/streaming/whep/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}
