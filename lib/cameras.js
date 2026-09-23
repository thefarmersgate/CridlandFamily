// The camera roster. Ids get filled from /v1/devices at setup; names and order
// are Mum's, not Ring's.
export const CAMERAS = [
  { key: "front", name: "Front Door",    ringId: process.env.CAM_FRONT || null, aspect: "16/9", battery: true },
  { key: "drive", name: "Driveway",      ringId: process.env.CAM_DRIVE || null, aspect: "16/9", battery: true },
  { key: "back",  name: "Back Verandah", ringId: process.env.CAM_BACK  || null, aspect: "16/9", battery: true },
  { key: "shed",  name: "Shed",          ringId: process.env.CAM_SHED  || null, aspect: "16/9", battery: true },
];

// The doorbell is its own device with its own aspect ratio. Pro 2 / Elite /
// Battery Doorbell Plus are 1536x1536 SQUARE; other models are 16:9. Set it
// from what /v1/devices actually reports, never from a spec sheet.
export const DOORBELL = {
  key: "bell", name: "Front Doorbell",
  ringId: process.env.CAM_BELL || null,
  aspect: process.env.BELL_ASPECT || "1/1",
};

export const byKey = (k) => [...CAMERAS, DOORBELL].find((c) => c.key === k) || null;
export const byRingId = (id) => [...CAMERAS, DOORBELL].find((c) => c.ringId === id) || null;

// Amber past ~3x the observed capture interval, not an absolute clock.
// A 27-minute-old photo is normal on solar-battery and must not look like a fault.
export const CAPTURE_INTERVAL_MIN = Number(process.env.CAPTURE_INTERVAL_MIN || 30);
export const STALE_MIN = CAPTURE_INTERVAL_MIN * 3;

// Show a "needs charging" banner at or below this battery percentage.
export const LOW_BATTERY_PCT = Number(process.env.LOW_BATTERY_PCT || 15);
