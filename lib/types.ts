export type Provenance = "structured" | "ai-extracted" | "ai-search" | "sample";

/** An event as returned by one source, before cleaning. */
export type RawEvent = {
  title: string;
  url: string;
  source: string; // e.g. "eventbrite", "rss:example.com", "gemini-search", "sample"
  provenance: Provenance;
  startDate: string | null; // ISO date or datetime; null = source did not say
  endDate?: string | null;
  city: string | null;
  venue?: string | null;
  isOnline?: boolean;
  organiser?: string | null;
  description?: string;
  registrationDeadline?: string | null; // null = NOT LISTED (never guessed)
  registrationClosed?: boolean; // source says closed / sold out / waitlist only
};

/** After dedupe: one event, possibly seen on several sources. */
export type Event = RawEvent & { id: string; sources: string[] };

export type DeadlineStatus = "urgent" | "open" | "passed" | "unknown";

export type ScoredEvent = Event & {
  score: number; // 0-100 match to focus areas
  matched: string[]; // focus areas matched
  reason: string; // one-line "why this is here"
  scoredBy: "gemini" | "keyword";
  evidence?: string; // verbatim quote that justified the AI score
  deadlineStatus: DeadlineStatus;
  daysLeft: number | null; // to registration deadline
  startsSoon: boolean; // starts within urgent window AND deadline unknown
  matchedCity: string | null; // which configured city it matched (null = online)
};

export type SourceHealth = {
  name: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
  skipped?: string;
};

export type Config = {
  recipientEmail: string;
  focusAreas: string[]; // the "categories" - editable in /settings
  cities: string[];
  includeOnline: boolean;
  windowDays: number; // look-ahead window (default 30)
  urgentDays: number; // flag if deadline is fewer than this many days away (default 7)
  maxEvents: number;
  minScore: number; // drop events scoring below this
  rssFeeds: string[]; // newsletter / blog / organiser feeds
  sources: { eventbrite: boolean; rss: boolean; geminiSearch: boolean; sample: boolean };
};

export type RunStats = {
  fetched: number;
  afterDedupe: number;
  droppedNoDate: number;
  droppedOutsideWindow: number;
  droppedWrongCity: number;
  droppedDeadlinePassed: number; // deadline gone OR source says registration closed
  droppedLowScore: number;
  scoredByGemini: number;
  scoredByKeyword: number;
};

export type RunResult = {
  generatedAt: string;
  config: Config;
  urgent: ScoredEvent[]; // deadline < urgentDays, soonest first
  events: ScoredEvent[]; // everything else, best match first
  health: SourceHealth[];
  stats: RunStats;
  aiNote?: string; // set when Gemini scoring was unavailable/failed
  hasSample: boolean;
};
