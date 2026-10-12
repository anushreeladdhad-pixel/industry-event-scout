import type { RunResult, ScoredEvent } from "./types";
import { escapeHtml as h, safeUrl } from "./util";
import { parseWhen, humanDaysLeft } from "./deadline";

export const fmtDate = (iso: string | null) => {
  const d = parseWhen(iso);
  return d
    ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
    : "Date TBC";
};

export function subjectLine(r: RunResult): string {
  const total = r.urgent.length + r.events.length;
  if (!total) return "Event Scout: no matching events in the next 30 days";
  const flag = r.urgent.length ? ` - ${r.urgent.length} closing within ${r.config.urgentDays} days` : "";
  return `Event Scout: ${total} event${total === 1 ? "" : "s"} in the next ${r.config.windowDays} days${flag}`;
}

export function deadlineBadge(e: ScoredEvent, urgentDays: number): { text: string; kind: "red" | "amber" | "grey" | "green" } {
  if (e.deadlineStatus === "urgent") return { text: `REGISTER NOW: ${humanDaysLeft(e.daysLeft!)} (by ${fmtDate(e.registrationDeadline!)})`, kind: "red" };
  if (e.deadlineStatus === "open") return { text: `Register by ${fmtDate(e.registrationDeadline!)}`, kind: "green" };
  if (e.startsSoon) return { text: `Starts within ${urgentDays} days, deadline not listed. Check now`, kind: "amber" };
  return { text: "Deadline not listed. Check the page", kind: "grey" };
}

const COLORS = {
  red: ["#fdecea", "#b3261e"],
  amber: ["#fff4d6", "#8a5a00"],
  grey: ["#eeeeee", "#555555"],
  green: ["#e6f4ea", "#1e6b3a"],
} as const;

function card(e: ScoredEvent, urgentDays: number): string {
  const b = deadlineBadge(e, urgentDays);
  const [bg, fg] = COLORS[b.kind];
  const where = e.matchedCity ?? "Online";
  const d = parseWhen(e.startDate);
  const day = d ? d.toLocaleDateString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }) : "?";
  const mon = d ? d.toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).toUpperCase() : "TBC";
  const scoreColor = e.score >= 80 ? "#15803d" : e.score >= 60 ? "#4338ca" : "#6b6878";
  const tag = (t: string, c: string, bgc: string) => `<span style="background:${bgc};color:${c};padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.04em">${t}</span>`;
  const tags = [
    e.provenance === "sample" ? tag("SAMPLE DATA", "#303f9f", "#e8eaf6") : "",
    e.provenance === "ai-search" ? tag("AI-found, verify", "#6a1b9a", "#f3e5f5") : "",
  ].filter(Boolean).join(" ");
  return `
<tr><td style="padding:0 0 12px">
 <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e0d6;border-left:4px solid ${fg};border-radius:12px;background:#ffffff"><tr>
  <td width="64" valign="top" align="center" style="padding:14px 0 14px 12px">
    <div style="background:#f5f3ee;border-radius:10px;padding:6px 0;width:52px"><div style="font-size:10px;font-weight:700;letter-spacing:.08em;color:#6b6878">${h(mon)}</div><div style="font-size:22px;font-weight:700;font-family:Georgia,serif;color:#16151d;line-height:1.1">${h(day)}</div></div>
  </td>
  <td valign="top" style="padding:14px 14px 14px 10px">
    <div style="font-size:12px;color:#6b6878">${h(fmtDate(e.startDate))} &middot; ${h(where)}${e.venue ? " &middot; " + h(e.venue) : ""} &middot; <b style="color:${scoreColor}">Match ${e.score}/100</b> ${tags}</div>
    <div style="font-size:17px;font-weight:700;margin:4px 0;line-height:1.3"><a href="${h(safeUrl(e.url))}" style="color:#16151d;text-decoration:none">${h(e.title)}</a></div>
    <div style="font-size:13px;color:#3f3d4a;margin-bottom:8px">${h(e.reason)}${e.organiser ? ` <span style="color:#6b6878">(${h(e.organiser)})</span>` : ""}</div>
    <span style="display:inline-block;background:${bg};color:${fg};padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700">${h(b.text)}</span>
    ${e.sources.length > 1 ? `<span style="font-size:11px;color:#6b6878"> &nbsp;listed on ${e.sources.length} sources</span>` : ""}
  </td></tr></table>
</td></tr>`;
}

export function renderDigestHtml(r: RunResult): string {
  const u = r.config.urgentDays;
  const total = r.urgent.length + r.events.length;
  const healthRows = r.health
    .map((s) => {
      const state = s.skipped ? `skipped (${h(s.skipped)})` : s.ok ? `${s.count} found` : `<b style="color:#b3261e">unavailable</b>: ${h(s.error ?? "")}`;
      return `<li>${h(s.name)}: ${state}</li>`;
    })
    .join("");
  const failed = r.health.filter((s) => !s.ok);
  return `<!doctype html><html><body style="margin:0;background:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#f5f3ee">
<tr><td bgcolor="#4338ca" style="background:#4338ca;background-image:linear-gradient(125deg,#312e81,#4338ca 45%,#7c3aed);border-radius:18px;padding:26px 26px 22px;color:#ffffff">
  <div style="font-size:11px;letter-spacing:.14em;color:#c7c3ff;text-transform:uppercase;font-weight:700">Your Monday event brief</div>
  <h1 style="font-size:26px;margin:8px 0 6px;font-family:Georgia,serif;line-height:1.2;color:#ffffff">${total} event${total === 1 ? "" : "s"} worth your time, next ${r.config.windowDays} days</h1>
  <div style="font-size:13px;color:#d9d6ff">Cities: ${h(r.config.cities.join(", "))} &middot; Focus: ${h(r.config.focusAreas.join("; "))}</div>
  ${r.hasSample ? `<div style="margin-top:10px;font-size:12px;background:#e8eaf6;color:#303f9f;padding:8px 10px;border-radius:8px">Showing SAMPLE events for demonstration. Turn off "sample data" in Settings once live sources are connected.</div>` : ""}
  ${failed.length ? `<div style="margin-top:10px;font-size:12px;background:#fff4d6;color:#8a5a00;padding:8px 10px;border-radius:8px"><b>Heads up:</b> ${failed.map((f) => h(f.name)).join(", ")} could not be checked this week, so coverage may be incomplete.</div>` : ""}
  ${r.aiNote ? `<div style="margin-top:10px;font-size:12px;background:#fff4d6;color:#8a5a00;padding:8px 10px;border-radius:8px">${h(r.aiNote)}</div>` : ""}
</td></tr>
${total === 0 ? `<tr><td style="padding:24px 0;color:#555">Nothing matched your cities and focus areas this week. That is a real result, not a failure. Widen your focus areas or cities in Settings if you expected more.</td></tr>` : ""}
${r.urgent.length ? `<tr><td style="padding-top:22px"><div style="font-size:15px;font-weight:700;color:#b42318;padding-bottom:10px">&#9888; Closing within ${u} days (${r.urgent.length})</div><table width="100%" cellpadding="0" cellspacing="0">${r.urgent.map((e) => card(e, u)).join("")}</table></td></tr>` : ""}
${r.events.length ? `<tr><td style="padding-top:22px"><div style="font-size:15px;font-weight:700;padding-bottom:10px">Best matches (${r.events.length})</div><table width="100%" cellpadding="0" cellspacing="0">${r.events.map((e) => card(e, u)).join("")}</table></td></tr>` : ""}
<tr><td style="padding-top:20px;font-size:11px;color:#777;line-height:1.5">
  <details><summary>How this was built</summary>
  Checked ${r.stats.fetched} listings, ${r.stats.afterDedupe} after removing duplicates. Dropped: ${r.stats.droppedNoDate} with no date, ${r.stats.droppedOutsideWindow} outside the window, ${r.stats.droppedWrongCity} in other cities, ${r.stats.droppedDeadlinePassed} with registration already closed, ${r.stats.droppedLowScore} weak matches.
  <ul style="margin:6px 0 0 16px;padding:0">${healthRows}</ul></details>
  <div style="margin-top:6px">Match scores are AI-assisted suggestions. Always confirm date, venue and deadline on the organiser's page before registering. Generated ${h(new Date(r.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST.</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderDigestText(r: RunResult): string {
  const u = r.config.urgentDays;
  const line = (e: ScoredEvent) =>
    `- ${e.title}\n  ${fmtDate(e.startDate)} | ${e.matchedCity ?? "Online"} | Match ${e.score}/100\n  ${deadlineBadge(e, u).text}\n  ${e.reason}\n  ${e.url}`;
  return [
    subjectLine(r),
    r.urgent.length ? `\nCLOSING WITHIN ${u} DAYS\n${r.urgent.map(line).join("\n")}` : "",
    r.events.length ? `\nBEST MATCHES\n${r.events.map(line).join("\n")}` : "",
    !r.urgent.length && !r.events.length ? "\nNothing matched your cities and focus areas this week." : "",
    "\nMatch scores are AI-assisted. Confirm details on the organiser's page before registering.",
  ].join("\n");
}
