// Google Calendar + Drive via a SERVICE ACCOUNT.
//
// Not OAuth: an external OAuth app in "Testing" gets a refresh token that expires
// every 7 days, and moving to production means verification because the calendar
// scope is sensitive. A service account has no refresh token, no consent screen,
// no expiry. It reads a calendar and a Drive folder that Mum has shared with it.
//
// Until GOOGLE_SA_KEY is set this module returns empty results, so the app runs
// end to end before the Google setup is done.

import { createSign } from "node:crypto";
import { memGet, memSet } from "./store.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

export const googleConfigured = () => !!process.env.GOOGLE_SA_KEY;

// Accepts the key file pasted as-is or base64-encoded.
export function creds() {
  // Tolerate a BOM, surrounding quotes, or the key file pasted as-is.
  const v = process.env.GOOGLE_SA_KEY.replace(/^\uFEFF/, "").trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();
  const raw = v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    // Describe the shape without echoing any of the secret.
    const kind = v.startsWith("{") ? "JSON that does not parse"
      : /^[A-Za-z0-9+/=\s]+$/.test(v) ? "base64 that is not a JSON key file"
      : "neither JSON nor base64";
    throw new Error(`GOOGLE_SA_KEY is ${kind} (${v.length} chars); paste the whole service-account .json file`);
  }
}
const b64url = (b) => Buffer.from(b).toString("base64url");

async function token() {
  const cached = memGet("g_at", 50 * 60 * 1000);
  if (cached) return cached;

  const { client_email, private_key } = creds();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: client_email,
    scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${signer.sign(private_key, "base64url")}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(`google token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  memSet("g_at", j.access_token);
  return j.access_token;
}

// Accept what people actually paste: a bare id, or a calendar embed/share
// link whose src= carries the id.
function calendarId(v) {
  v = v.trim();
  if (!/^https?:/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.searchParams.get("src") || u.searchParams.get("cid") || v;
  } catch { return v; }
}

// A Drive folder link or a bare folder id.
export const folderId = (v) => (v || "").trim().match(/folders\/([\w-]+)/)?.[1] || (v || "").trim();

/**
 * Next 14 days. GCAL_ID takes one calendar or a comma-separated list, so her
 * primary calendar ("mum@gmail.com") can be read alongside any shared one
 * without locking the choice in now.
 */
export async function calendar() {
  if (!googleConfigured() || !process.env.GCAL_ID) return [];
  const ids = process.env.GCAL_ID.split(",").map(calendarId).filter(Boolean);
  const at = await token();
  const now = new Date();
  const end = new Date(now.getTime() + 14 * 864e5);

  const per = await Promise.allSettled(ids.map(async (id) => {
    const qs = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",        // expands recurrences; without it nothing useful comes back
      orderBy: "startTime",
      maxResults: "50",
    });
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${qs}`,
      { headers: { Authorization: `Bearer ${at}` } }
    );
    if (!r.ok) throw new Error(`gcal ${id}: ${r.status}`);
    const j = await r.json();
    return (j.items || []).map((e) => ({
      id: e.id,
      calendar: id,
      title: e.summary || "(No title)",
      // All-day events are date-only with NO timezone. Pass the string straight
      // through - turning it into a Date lands it on the wrong day in Adelaide.
      startsAt: e.start?.dateTime || e.start?.date,
      endsAt: e.end?.dateTime || e.end?.date || null,
      allDay: !!e.start?.date,
      location: e.location || null,
    }));
  }));

  // One bad calendar must not blank the others.
  per.filter((p) => p.status === "rejected").forEach((p) => console.warn(p.reason?.message));
  // If none could be read, say why instead of looking like an empty diary.
  if (per.length && per.every((p) => p.status === "rejected")) throw per[0].reason;

  return per
    .filter((p) => p.status === "fulfilled")
    .flatMap((p) => p.value)
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
    .slice(0, 60);
}

/**
 * Family photos from a shared Drive folder.
 * Google Photos is not an option: since 31 Mar 2025 its Library API only reaches
 * media the calling app uploaded, and the Picker API needs a human to choose
 * pictures every session - meaningless on an unattended frame.
 */
export async function photos(limit = 60) {
  if (!googleConfigured() || !process.env.GDRIVE_FOLDER_ID) return [];
  const at = await token();
  const qs = new URLSearchParams({
    q: `'${folderId(process.env.GDRIVE_FOLDER_ID)}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "files(id,name,size,createdTime,imageMediaMetadata/width,imageMediaMetadata/height)",
    orderBy: "createdTime desc",
    pageSize: String(limit),
  });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?${qs}`, {
    headers: { Authorization: `Bearer ${at}` },
  });
  if (!r.ok) throw new Error(`drive: ${r.status}`);
  const j = await r.json();
  return (j.files || [])
    .filter((f) => !f.size || Number(f.size) < 8 * 1024 * 1024)  // skip anything huge
    .map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime }));
}

/** Streams one Drive image through, so the service-account key never reaches the browser. */
export async function photoBytes(fileId) {
  if (!googleConfigured()) return null;
  const at = await token();
  // Prefer Drive's resized rendition (~1920px): a phone original can be
  // several MB, far more than a 1920x1280 frame can show.
  try {
    const m = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=thumbnailLink`,
      { headers: { Authorization: `Bearer ${at}` } }
    );
    const link = m.ok ? (await m.json()).thumbnailLink : null;
    if (link) {
      const t = await fetch(link.replace(/=s\d+[^&]*$/, "=s1920"), { headers: { Authorization: `Bearer ${at}` } });
      if (t.ok && (t.headers.get("content-type") || "").startsWith("image/")) {
        return { buffer: Buffer.from(await t.arrayBuffer()), contentType: t.headers.get("content-type") };
      }
    }
  } catch (e) { console.warn("photo thumbnail", fileId, e.message); }

  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${at}` } }
  );
  if (!r.ok) return null;
  return {
    buffer: Buffer.from(await r.arrayBuffer()),
    contentType: r.headers.get("content-type") || "image/jpeg",
  };
}
