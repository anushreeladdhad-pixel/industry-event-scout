"use client";
import { useEffect, useMemo, useState } from "react";
import { useToken } from "./useToken";

type Health = { name: string; ok: boolean; count: number; ms: number; error?: string; skipped?: string };
type Row = {
  urgent: boolean; title: string; url: string; start: string | null; startLabel: string; city: string; venue: string; organiser: string;
  score: number; reason: string; badge: string; badgeKind: "red" | "amber" | "grey" | "green"; daysLeft: number | null; sources: number; sample: boolean; aiFound: boolean;
};
type Preview = {
  subject: string; html: string; health: Health[]; aiNote: string | null; generatedAt: string; error?: string;
  stats?: { afterDedupe: number }; counts?: { urgent: number; events: number }; cities?: string[]; rows?: Row[];
};
type SortKey = "start" | "score" | "city" | "deadline";

export default function Home() {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useToken();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"table" | "email">("table");
  const [sort, setSort] = useState<SortKey>("start");
  const [city, setCity] = useState("All");

  async function load(fresh = false) {
    setLoading(true);
    try {
      const r = await fetch(`/api/preview${fresh ? "?fresh=1" : ""}`);
      setData(await r.json());
    } catch {
      setData({ subject: "", html: "", health: [], aiNote: null, generatedAt: "", error: "Could not reach the server." });
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function send() {
    if (!token.trim()) { setMsg({ ok: false, text: "Type your admin token in the box first." }); return; }
    setSending(true); setMsg(null);
    try {
      const r = await fetch("/api/send", { method: "POST", headers: { "x-admin-token": token.trim() } });
      const j = await r.json();
      setMsg(r.ok ? { ok: true, text: `Sent to ${j.to}. Check your inbox.` } : { ok: false, text: r.status === 401 ? "Wrong admin token." : (j.error ?? "Failed") });
    } catch { setMsg({ ok: false, text: "Network error" }); }
    setSending(false);
  }

  const ok = !!data && !data.error;
  const total = ok && data!.counts ? data!.counts.urgent + data!.counts.events : 0;
  const cities = useMemo(() => ["All", ...Array.from(new Set((data?.rows ?? []).map((r) => r.city)))], [data]);
  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) => city === "All" || r.city === city);
    const by: Record<SortKey, (a: Row, b: Row) => number> = {
      start: (a, b) => (a.start ?? "9").localeCompare(b.start ?? "9"),
      score: (a, b) => b.score - a.score,
      city: (a, b) => a.city.localeCompare(b.city) || b.score - a.score,
      deadline: (a, b) => (a.daysLeft ?? 9e3) - (b.daysLeft ?? 9e3),
    };
    return [...list].sort(by[sort]);
  }, [data, sort, city]);

  return (
    <>
      <section className="hero">
        <span className="eyebrow">● Every Monday · 7:30 AM IST</span>
        <h1>Never miss the room where your next client is.</h1>
        <p>One ranked list of in-person events in your cities, scored against your focus areas, with closing deadlines flagged so nothing slips by a day.</p>
        <div className="cta">
          <button onClick={() => load(true)} disabled={loading}>{loading ? "Building digest…" : "↻ Refresh digest"}</button>
          <input type="password" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Admin token" autoComplete="off" style={{ width: 200 }} />
          <button className="secondary" onClick={send} disabled={sending}>{sending ? "Sending…" : "✉ Email it to me now"}</button>
          {token && <button className="linkish" onClick={() => setToken("")}>Clear</button>}
        </div>
        {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div>}
      </section>

      {ok && data!.counts && (
        <section className="tiles" aria-label="This week at a glance">
          <div className="tile good"><b>{total}</b><span>events worth your time</span></div>
          <div className="tile urgent"><b>{data!.counts.urgent}</b><span>closing within 7 days</span></div>
          <div className="tile"><b>{data!.stats?.afterDedupe ?? 0}</b><span>listings scanned</span></div>
          <div className="tile"><b>{data!.cities?.length ?? 0}</b><span>cities watched</span></div>
        </section>
      )}

      {data?.error && <div className="notice err" role="alert">{data.error}</div>}
      {data?.aiNote && <div className="notice" role="status">⚠ {data.aiNote}</div>}

      {ok && (
        <div className="pills" style={{ margin: "14px 0" }}>
          {data!.health.map((h) => (
            <span key={h.name} className={`pill ${h.skipped ? "skip" : h.ok ? "" : "fail"}`} title={h.skipped ?? h.error ?? ""}>
              <i />{h.name} <em>{h.skipped ? "skipped" : h.ok ? `${h.count} found` : "unavailable"}</em>
            </span>
          ))}
        </div>
      )}

      {loading && !data && <div className="card"><div className="skeleton" style={{ width: "60%" }} /><div className="skeleton" /><div className="skeleton" style={{ width: "80%" }} /></div>}

      {ok && (
        <>
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === "table"} className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
              <button role="tab" aria-selected={view === "email"} className={view === "email" ? "on" : ""} onClick={() => setView("email")}>Email preview</button>
            </div>
            {view === "table" && (
              <div className="row">
                <label className="inl" htmlFor="city">City</label>
                <select id="city" value={city} onChange={(e) => setCity(e.target.value)}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
                <label className="inl" htmlFor="sort">Sort by</label>
                <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="start">Date</option><option value="score">Match</option><option value="deadline">Deadline</option><option value="city">City</option>
                </select>
              </div>
            )}
          </div>

          {view === "table" ? (
            <div className="tablewrap">
              <table className="events">
                <thead><tr><th>Date</th><th>Event</th><th>City</th><th>Match</th><th>Registration</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="empty">Nothing matches this filter.</td></tr>}
                  {rows.map((r, i) => (
                    <tr key={i} className={r.urgent ? "urgent" : ""}>
                      <td className="nowrap"><b>{r.startLabel}</b></td>
                      <td>
                        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="etitle">{r.title}</a> : <span className="etitle">{r.title}</span>}
                        {r.sample && <span className="tag sample">SAMPLE</span>}
                        {r.aiFound && <span className="tag ai">AI-found, verify</span>}
                        <div className="sub">{r.reason}{r.organiser ? ` · ${r.organiser}` : ""}{r.sources > 1 ? ` · on ${r.sources} sources` : ""}</div>
                      </td>
                      <td>{r.city}{r.venue && <div className="sub">{r.venue}</div>}</td>
                      <td className="nowrap"><div className="meter" title={`${r.score}/100`}><i style={{ width: `${r.score}%` }} /></div><span className="score">{r.score}</span></td>
                      <td><span className={`badge ${r.badgeKind}`}>{r.badge}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mail">
              <div className="bar"><span /><span /><span /></div>
              <div className="subj"><small>Subject</small>{data!.subject}</div>
              <iframe title="Digest preview" srcDoc={data!.html} sandbox="" />
            </div>
          )}
          <p className="foot">Match scores are AI-assisted. Confirm date, venue and deadline on the organiser's page before registering.</p>
        </>
      )}
    </>
  );
}
