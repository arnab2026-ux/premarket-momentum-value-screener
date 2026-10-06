/** NYSE calendar + America/New_York clock helpers (DST-safe via Intl). */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const last = new Date(Date.UTC(y, m, 0));
  return last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7);
}
function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}
/** Fixed-date holiday: Saturday -> Friday, Sunday -> Monday. Null if the observed date falls in another year. */
function observed(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(d - 1);
  else if (dow === 0) dt.setUTCDate(d + 1);
  if (dt.getUTCFullYear() !== y) return null; // Jan 1 on a Saturday: NYSE stays open the prior Dec 31
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function nyseHolidays(y: number): Set<string> {
  const s = new Set<string>();
  const add = (v: string | null) => { if (v) s.add(v); };
  add(observed(y, 1, 1));
  add(iso(y, 1, nthWeekday(y, 1, 1, 3))); // MLK
  add(iso(y, 2, nthWeekday(y, 2, 1, 3))); // Presidents
  const [em, ed] = easter(y); // Good Friday
  const gf = new Date(Date.UTC(y, em - 1, ed - 2));
  add(iso(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()));
  add(iso(y, 5, lastWeekday(y, 5, 1))); // Memorial
  if (y >= 2022) add(observed(y, 6, 19)); // Juneteenth
  add(observed(y, 7, 4));
  add(iso(y, 9, nthWeekday(y, 9, 1, 1))); // Labor
  add(iso(y, 11, nthWeekday(y, 11, 4, 4))); // Thanksgiving
  add(observed(y, 12, 25));
  return s;
}

export function isTradingDay(dateIso: string): boolean {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !nyseHolidays(y).has(dateIso);
}

export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function previousTradingDay(dateIso: string): string {
  let d = addDays(dateIso, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

export interface NyClock { date: string; hour: number; minute: number }

export function nyClock(now: Date = new Date(), tz = "America/New_York"): NyClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** Is `now` within +/- tolerance minutes of the target New York wall-clock time? */
export function withinRunWindow(
  now: Date, target: { hour: number; minute: number; toleranceMinutes: number }, tz?: string,
): boolean {
  const c = nyClock(now, tz);
  return Math.abs(c.hour * 60 + c.minute - (target.hour * 60 + target.minute)) <= target.toleranceMinutes;
}
