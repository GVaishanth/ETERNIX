/** Race time as m:ss.t (tenths of a second). Pure, so it is unit-tested. Negative and non-finite values show as 0:00.0. */
export function formatRaceTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const tenths = Math.floor(safe * 10 + 1e-9);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  const tenth = tenths % 10;
  return `${minutes}:${String(secs).padStart(2, '0')}.${tenth}`;
}

/** Ordinal place label: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st. */
export function formatPlace(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1: return `${place}st`;
    case 2: return `${place}nd`;
    case 3: return `${place}rd`;
    default: return `${place}th`;
  }
}
