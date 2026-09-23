// Ring Partner API. https://api.amazonvision.com
//
// Rules this module enforces, from the spec:
//   D3a  Never trigger a capture. Never open a stream except on an explicit tap.
//   A1   Reads only; the carousel triggers nothing.
//   A24  Honour Retry-After on 429; never a fixed sleep.
//   §5.4 The refresh token ROTATES - always write the new one back.

import { cfgGet, cfgSet, memGet, memSet } from "./store.js";

const BASE = "https://api.amazonvision.com";
// Tokens come from Ring's OAuth host, not the API host.
export const TOKEN_URL = "https://oauth.ring.com/oauth/token";
export const REFRESH_KEY = "ring_refresh_token";
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

/** JSON:API status resource; returns its attributes, e.g. { online: true }. */
export async function deviceStatus(id) {
  const r = await ringFetch(`/v1/devices/${encodeURIComponent(id)}/status`);
  if (!r.ok) return null;
  return (await r.json())?.data?.attributes ?? null;
}

/**
 * Battery percentage from a status resource, or null. The partner docs only
 * promise battery_status for sensors, so accept the likely shapes and treat
 * anything outside 0-100 (mains devices report 255) as "no battery".
 */
export function batteryOf(status) {
  const v = status?.battery_status?.percentage ?? status?.battery_level ?? status?.battery?.percentage ?? null;
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Flatten a JSON:API /v1/devices response (with ?include=status,capabilities)
 * into { id, name, online, ratio, aspect } rows.
 */
export function normalizeDevices(body) {
  const inc = new Map((body?.included || []).map((x) => [`${x.type}:${x.id}`, x.attributes || {}]));
  const rel = (d, name) => {
    const ref = d.relationships?.[name]?.data;
    return ref ? inc.get(`${ref.type}:${ref.id}`) || {} : {};
  };
  return (body?.data || []).map((d) => {
    const ratio = rel(d, "capabilities").video?.ratio || null;       // "16:9"
    const [w, h] = ratio ? ratio.split(":").map(Number) : [];
    return {
      id: d.id,
      name: d.attributes?.name || "(unnamed)",
      online: rel(d, "status").online ?? null,
      ratio,
      aspect: w && h ? `${w}/${h}` : null,
    };
  });
}

/**
 * READ the most recent stored image from the last 24 hours. latest_in_range
 * returns what Ring already holds and never asks the camera for a new one.
 * Ring answers 303 with a pre-signed URL; fetch follows it to the bytes.
 */
export async function snapshot(id) {
  // Ring only releases media recorded after the user consented, so the window
  // starts at the link time. Older links have no stored time: fall back to
  // progressively shorter windows until Ring accepts one.
  const now = Date.now();
  const linkedAt = Number(await cfgGet("ring_linked_at").catch(() => null)) || 0;
  const day = now - 24 * 60 * 60 * 1000 + 60 * 1000;
  // Without a stored link time, narrow the window step by step; the first
  // start Ring accepts is remembered so later reads take one call.
  const MIN = 60 * 1000;
  const starts = linkedAt
    ? [Math.max(day, linkedAt + 1000)]
    : [day, ...[720, 360, 180, 90, 45, 20, 10, 5, 2].map((m) => now - m * MIN)];

  for (const start_timestamp of starts) {
    const r = await ringFetch(`/v1/devices/${encodeURIComponent(id)}/media/image/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "latest_in_range", start_timestamp, image_options: { format: "jpeg" } }),
    });
    if (r.ok || r.status === 416) {
      if (!linkedAt) await cfgSet("ring_linked_at", start_timestamp).catch(() => {});
    }
    if (r.ok) {
      const at = Number(r.headers.get("x-media-timestamp")) || null;
      return {
        buffer: Buffer.from(await r.arrayBuffer()),
        contentType: r.headers.get("content-type") || "image/jpeg",
        capturedAt: at,
      };
    }
    const detail = (await r.text()).slice(0, 200);
    if (r.status === 403 && detail.includes("TIME_RANGE_NOT_AUTHORIZED")) continue;
    // 416 MEDIA_NOT_FOUND: nothing captured in the window yet.
    if (r.status !== 416) console.warn("snapshot", id, r.status, detail);
    return null;
  }
  console.warn("snapshot", id, "no authorised time range");
  return null;
}

/* ---------------- account linking ---------------- */

async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: process.env.RING_ID, client_secret: process.env.RING_SECRET }),
  });
  if (!r.ok) throw new Error(`ring token ${params.grant_type}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
export const exchangeCode = (code) => tokenRequest({ grant_type: "authorization_code", code });
export const refreshWith = (refresh_token) => tokenRequest({ grant_type: "refresh_token", refresh_token });

/** The Ring Account ID for a token - what the linking nonce is computed over. */
export async function usersMe(access) {
  const r = await fetch(`${BASE}/v1/users/me`, { headers: { Authorization: `Bearer ${access}` } });
  if (!r.ok) throw new Error(`users/me: ${r.status}`);
  return (await r.json()).data.id;
}

/** POST (nonce) then PATCH (completed) - both are required to finish a link. */
export async function confirmLink(access, nonce, accountIdentifier) {
  const call = async (method, body) => {
    const r = await fetch(`${BASE}/v1/accounts/me/app-integrations`, {
      method,
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`app-integrations ${method}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  await call("POST", { account_identifier: accountIdentifier, nonce });
  return call("PATCH", { status: "completed" });
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
