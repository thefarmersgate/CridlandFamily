// Open-Meteo. No key, free for non-commercial use.
import { memGet, memSet } from "./store.js";

const LAT = process.env.LAT || "-34.98708";   // Glengowrie SA 5044
const LON = process.env.LON || "138.53674";
const TZ  = process.env.TZ_NAME || "Australia/Adelaide";

export async function weather() {
  const cached = memGet("wx", 15 * 60 * 1000);
  if (cached) return cached;

  const qs = new URLSearchParams({
    latitude: LAT, longitude: LON,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: TZ, forecast_days: "4",
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!r.ok) throw new Error(`open-meteo: ${r.status}`);
  const j = await r.json();

  const out = {
    now: {
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      humidity: j.current.relative_humidity_2m,
      code: j.current.weather_code,
      wind: Math.round(j.current.wind_speed_10m),
      windDir: j.current.wind_direction_10m,
    },
    sunset: j.daily.sunset?.[0] || null,
    sunrise: j.daily.sunrise?.[0] || null,
    days: (j.daily.time || []).slice(1, 4).map((d, i) => ({
      date: d,
      code: j.daily.weather_code[i + 1],
      hi: Math.round(j.daily.temperature_2m_max[i + 1]),
      lo: Math.round(j.daily.temperature_2m_min[i + 1]),
      pop: j.daily.precipitation_probability_max?.[i + 1] ?? null,
    })),
  };
  memSet("wx", out);
  return out;
}

/** WMO code -> the words she reads. */
export function describe(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Storms";
}
