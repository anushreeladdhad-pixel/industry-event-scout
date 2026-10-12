import type { RawEvent } from "../types";

/**
 * SAMPLE data so the app always has something to show at submission time ("must work with some
 * data"). Dates are generated relative to `now` so the demo never goes stale. Every item is
 * clearly labelled SAMPLE in the digest and uses example.com links. Turn off in Settings for
 * real use. The set deliberately exercises every edge case in the pipeline.
 */
export function sampleEvents(now: Date): RawEvent[] {
  // Calendar dates in IST (the user's timezone), so "3 days from today" is stable at any hour of the day
  const day = (n: number) => new Date(now.getTime() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const base = { provenance: "sample" as const, isOnline: false };
  return [
    // 1. Urgent: deadline in 3 days, squarely in focus (the "CIO roundtable" scenario from the brief)
    { ...base, source: "sample", title: "[SAMPLE] CIO Roundtable: AI Operating Models", url: "https://example.com/sample/cio-roundtable", startDate: day(9), city: "Bengaluru", venue: "Sample Hotel", organiser: "Sample CIO Forum", description: "Invite-only roundtable for CIOs and CTOs on operating models for enterprise AI adoption and digital transformation.", registrationDeadline: day(3) },
    // 2. Same event on a second platform with different wording + later deadline -> must dedupe, keep EARLIER deadline
    { ...base, source: "sample-2", title: "CIO Roundtable - AI Operating Models (Bangalore)", url: "https://example.com/sample/alt/cio-roundtable-ai", startDate: day(9), city: "Bangalore", description: "CIO and CTO roundtable about AI operating models.", registrationDeadline: day(6) },
    // 3. Strong match, deadline comfortably open
    { ...base, source: "sample", title: "[SAMPLE] CXO Summit: Digital Transformation 2026", url: "https://example.com/sample/cxo-summit", startDate: day(16), city: "Mumbai", venue: "Sample Convention Centre", organiser: "Sample Media", description: "Two-day CXO summit on enterprise technology, digital transformation and management strategy.", registrationDeadline: day(12) },
    // 4. Good match, NO deadline listed -> must say "not listed", not "safe"
    { ...base, source: "sample", title: "[SAMPLE] Startup Founders Meetup", url: "https://example.com/sample/founders-meetup", startDate: day(11), city: "Hyderabad", organiser: "Sample Startup Hub", description: "Monthly startup ecosystem meetup for founders and investors.", registrationDeadline: null },
    // 5. Starts in 4 days, no deadline -> flagged "starts soon"
    { ...base, source: "sample", title: "[SAMPLE] Management Consulting Leaders Breakfast", url: "https://example.com/sample/consulting-breakfast", startDate: day(4), city: "Delhi NCR", venue: "Gurugram", description: "Breakfast briefing for management consulting and strategy leaders.", registrationDeadline: null },
    // 6. Registration already closed -> dropped
    { ...base, source: "sample", title: "[SAMPLE] CIO Strategy Forum (registration closed)", url: "https://example.com/sample/closed", startDate: day(8), city: "Bengaluru", description: "CIO strategy forum on technology leadership.", registrationDeadline: day(-2) },
    // 7. Outside the 30-day window -> dropped
    { ...base, source: "sample", title: "[SAMPLE] Annual Strategy Conference", url: "https://example.com/sample/far", startDate: day(45), city: "Mumbai", description: "Management strategy conference.", registrationDeadline: day(30) },
    // 8. Wrong city -> dropped
    { ...base, source: "sample", title: "[SAMPLE] CIO Summit Chennai", url: "https://example.com/sample/chennai", startDate: day(10), city: "Chennai", description: "CIO summit on digital transformation.", registrationDeadline: day(5) },
    // 9. No date at all -> dropped (cannot place it in the 30-day window), counted in stats
    { ...base, source: "sample", title: "[SAMPLE] Executive Roundtable (date TBA)", url: "https://example.com/sample/tba", startDate: null, city: "Mumbai", description: "CXO roundtable, date to be announced.", registrationDeadline: null },
    // 10. Irrelevant -> low score
    { ...base, source: "sample", title: "[SAMPLE] Weekend Pottery Workshop", url: "https://example.com/sample/pottery", startDate: day(7), city: "Bengaluru", description: "Beginner pottery class.", registrationDeadline: day(5) },
    // 11. Edge: deadline exactly 7 days out (NOT "fewer than seven") -> not flagged
    { ...base, source: "sample", title: "[SAMPLE] Digital Transformation Leaders Roundtable", url: "https://example.com/sample/seven", startDate: day(20), city: "Hyderabad", description: "Roundtable for digital transformation and enterprise technology leaders.", registrationDeadline: day(7) },
  ];
}
