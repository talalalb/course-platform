export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || 'Asia/Riyadh';
}

/** Offset (ms) between the wall-clock time in `timeZone` and UTC at the given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a `datetime-local` value ("YYYY-MM-DDTHH:mm") entered in `timeZone` to a UTC Date. */
export function zonedLocalToUtc(local: string, timeZone: string = appTimeZone()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const firstOffset = tzOffsetMs(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  const secondOffset = tzOffsetMs(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Formats a UTC Date as a `datetime-local` value in `timeZone`. */
export function utcToZonedInput(date: Date, timeZone: string = appTimeZone()): string {
  const shifted = new Date(date.getTime() + tzOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}
