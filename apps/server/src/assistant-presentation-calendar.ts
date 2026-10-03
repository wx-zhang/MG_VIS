const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

const weekday = `(${WEEKDAYS.join("|")})`;
const month = `(${MONTHS.join("|")})`;
const dayMonthYear = new RegExp(`\\b${weekday},?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+${month},?[ \\t]+(\\d{4})\\b`, "gi");
const monthDayYear = new RegExp(`\\b${weekday},?[ \\t]+${month}[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]+(\\d{4})\\b`, "gi");
const isoDate = new RegExp(`\\b${weekday},?[ \\t]+(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi");

function verifiedWeekday(year: number, monthNumber: number, day: number): string | null {
  if (year < 1000 || year > 9999 || monthNumber < 1 || monthNumber > 12 || day < 1 || day > 31) return null;
  // UTC checks the written calendar date without depending on the server's timezone.
  const date = new Date(Date.UTC(year, monthNumber - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthNumber - 1 || date.getUTCDate() !== day) return null;
  return WEEKDAYS[date.getUTCDay()];
}

function monthNumber(name: string): number {
  return MONTHS.findIndex((monthName) => monthName.toLowerCase() === name.toLowerCase()) + 1;
}

function supportedPair(writtenWeekday: string, year: number, month: number, day: number): string | null {
  const actual = verifiedWeekday(year, month, day);
  return actual?.toLowerCase() === writtenWeekday.toLowerCase() ? `${year}-${month}-${day}` : null;
}

function workerWeekdayPairs(workerResult: string): Set<string> {
  const pairs = new Set<string>();
  const add = (pair: string | null): void => { if (pair) pairs.add(pair); };
  workerResult.replace(dayMonthYear, (match, written, day, monthName, year) => {
    add(supportedPair(written, Number(year), monthNumber(monthName), Number(day)));
    return match;
  });
  workerResult.replace(monthDayYear, (match, written, monthName, day, year) => {
    add(supportedPair(written, Number(year), monthNumber(monthName), Number(day)));
    return match;
  });
  workerResult.replace(isoDate, (match, written, year, month, day) => {
    add(supportedPair(written, Number(year), Number(month), Number(day)));
    return match;
  });
  return pairs;
}

function groundedPair(match: string, written: string, pair: string | null, workerPairs: Set<string>): string {
  if (pair && workerPairs.has(pair)) return match;
  return match.slice(written.length).replace(/^,?[ \t]+/, "");
}

/** The model may reword a date but may not add a weekday missing from the returned result. */
export function groundPresentedWeekdays(content: string, workerResult: string): string {
  const workerPairs = workerWeekdayPairs(workerResult);
  return content
    .replace(dayMonthYear, (match, written, day, monthName, year) =>
      groundedPair(match, written, supportedPair(written, Number(year), monthNumber(monthName), Number(day)), workerPairs))
    .replace(monthDayYear, (match, written, monthName, day, year) =>
      groundedPair(match, written, supportedPair(written, Number(year), monthNumber(monthName), Number(day)), workerPairs))
    .replace(isoDate, (match, written, year, monthNumber, day) =>
      groundedPair(match, written, supportedPair(written, Number(year), Number(monthNumber), Number(day)), workerPairs));
}
