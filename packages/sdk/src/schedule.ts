/**
 * Pyth market-hours schedules, e.g.
 * `America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;1126/C,1127/0930-1300`.
 * The weekly part lists Monday to Sunday; each entry is `C` (closed), `O` (open all day) or
 * comma-free `HHMM-HHMM` ranges joined by `&`. Holidays override one `MMDD`.
 * Used for display and retry timing only: the onchain freshness check decides whether a price
 * is usable.
 */

type Range = { open: number; close: number };
type Day = Range[];

export type MarketSchedule = {
  timeZone: string;
  weekly: Day[];
  holidays: Map<string, Day>;
};

function parseDay(spec: string): Day {
  if (spec === "C") return [];
  if (spec === "O") return [{ open: 0, close: 24 * 60 }];
  return spec.split("&").map((range) => {
    const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(range);
    if (!match) throw new Error(`bad schedule range ${range}`);
    const [, oh, om, ch, cm] = match.map(Number) as [number, number, number, number, number];
    return { open: oh * 60 + om, close: ch * 60 + cm };
  });
}

export function parseSchedule(schedule: string): MarketSchedule {
  const [timeZone, weeklySpec, holidaySpec] = schedule.split(";");
  if (!timeZone || !weeklySpec) throw new Error(`bad schedule ${schedule}`);
  const weekly = weeklySpec.split(",").map(parseDay);
  if (weekly.length !== 7) throw new Error(`schedule needs 7 weekdays: ${schedule}`);
  const holidays = new Map<string, Day>();
  for (const entry of holidaySpec ? holidaySpec.split(",").filter(Boolean) : []) {
    const [date, spec] = entry.split("/");
    if (!date || !spec) throw new Error(`bad holiday ${entry}`);
    holidays.set(date, parseDay(spec));
  }
  return { timeZone, weekly, holidays };
}

type LocalParts = { year: number; month: number; day: number; weekday: number; minutes: number };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function localParts(utcMs: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** UTC milliseconds for a wall-clock time in `timeZone`, correct across DST changes. */
function zonedToUtc(year: number, month: number, day: number, minutes: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  let utc = guess;
  for (let i = 0; i < 2; i++) {
    const local = localParts(utc, timeZone);
    const asUtc = Date.UTC(local.year, local.month - 1, local.day, 0, local.minutes);
    utc += guess - asUtc;
  }
  return utc;
}

function sessionsOn(schedule: MarketSchedule, parts: LocalParts): Day {
  const key = `${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
  return schedule.holidays.get(key) ?? schedule.weekly[parts.weekday] ?? [];
}

export function isOpen(schedule: MarketSchedule, utcMs: number): boolean {
  const parts = localParts(utcMs, schedule.timeZone);
  return sessionsOn(schedule, parts).some(
    (range) => parts.minutes >= range.open && parts.minutes < range.close,
  );
}

/** The next session open strictly after `utcMs`, searching up to 14 days ahead. */
export function nextOpen(schedule: MarketSchedule, utcMs: number): number | null {
  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const probe = localParts(utcMs + dayOffset * 86_400_000, schedule.timeZone);
    for (const range of sessionsOn(schedule, probe)) {
      const openUtc = zonedToUtc(probe.year, probe.month, probe.day, range.open, schedule.timeZone);
      if (openUtc > utcMs) return openUtc;
    }
  }
  return null;
}
