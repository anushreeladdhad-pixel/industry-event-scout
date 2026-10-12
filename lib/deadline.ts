import type { DeadlineStatus } from "./types";

const IST = "+05:30";
const DAY = 86_400_000;

/**
 * Parse a date. A date-only string ("2026-10-20") has no time, so a *deadline* on that date is
 * treated as end-of-day IST (the organiser's "last day to register" is still open that evening),
 * while an *event start* is treated as start-of-day.
 */
export function parseWhen(s: string | null | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  // JS silently rolls impossible calendar dates over (2026-02-30 -> 2 March). Reject them instead.
  const ymd = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return new Date(`${t}T${endOfDay ? "23:59:59" : "00:00:00"}${IST}`);
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DeadlineInfo = { status: DeadlineStatus; daysLeft: number | null };

/**
 * urgent  = deadline is in the future but FEWER than `urgentDays` days away (the brief's rule)
 * passed  = deadline already gone
 * open    = deadline is `urgentDays` or more away
 * unknown = no deadline listed. Never treated as "safe" - the digest says so explicitly.
 */
export function classifyDeadline(
  deadline: string | null | undefined,
  now: Date,
  urgentDays = 7
): DeadlineInfo {
  const d = parseWhen(deadline, true);
  if (!d) return { status: "unknown", daysLeft: null };
  const daysLeft = (d.getTime() - now.getTime()) / DAY;
  if (daysLeft < 0) return { status: "passed", daysLeft };
  if (daysLeft < urgentDays) return { status: "urgent", daysLeft };
  return { status: "open", daysLeft };
}

/** True when the event itself starts within `urgentDays` but no deadline is listed. */
export function startsSoonWithoutDeadline(
  start: string | null | undefined,
  deadline: string | null | undefined,
  now: Date,
  urgentDays = 7
): boolean {
  if (deadline) return false;
  const s = parseWhen(start, false);
  if (!s) return false;
  const days = (s.getTime() - now.getTime()) / DAY;
  return days >= 0 && days < urgentDays;
}

export function humanDaysLeft(daysLeft: number): string {
  if (daysLeft < 1) return "closes today";
  const n = Math.ceil(daysLeft);
  return n === 1 ? "1 day left" : `${n} days left`;
}
