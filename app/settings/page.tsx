"use client";
import { useEffect, useState } from "react";
import { useToken } from "../useToken";

type Cfg = {
  recipientEmail: string; focusAreas: string[]; cities: string[]; includeOnline: boolean;
  windowDays: number; urgentDays: number; maxEvents: number; minScore: number; rssFeeds: string[];
  sources: { eventbrite: boolean; rss: boolean; geminiSearch: boolean; sample: boolean };
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function Settings() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [editable, setEditable] = useState(true);
  const [token, setToken] = useToken();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [txt, setTxt] = useState({ focus: "", cities: "", feeds: "" });

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then((j) => {
      setCfg(j.config); setEditable(j.editable);
      setTxt({ focus: j.config.focusAreas.join("\n"), cities: j.config.cities.join("\n"), feeds: j.config.rssFeeds.join("\n") });
    });
  }, []);

  async function save() {
    if (!cfg) return;
    setSaving(true); setMsg(null);
    const body = { ...cfg, focusAreas: lines(txt.focus), cities: lines(txt.cities), rssFeeds: lines(txt.feeds) };
    const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json", "x-admin-token": token }, body: JSON.stringify(body) });
    const j = await r.json();
    setMsg(r.ok ? { ok: true, text: "Saved. The next digest uses these settings. No code change needed." } : { ok: false, text: j.error ?? "Could not save" });
    setSaving(false);
  }

  if (!cfg) return <div className="card"><div className="skeleton" style={{ width: "50%" }} /><div className="skeleton" /><div className="skeleton" style={{ width: "70%" }} /></div>;
  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setCfg({ ...cfg, [k]: v });
  const src = (k: keyof Cfg["sources"], label: string, hint: string) => (
    <label className="toggle">
      <input type="checkbox" checked={cfg.sources[k]} onChange={(e) => set("sources", { ...cfg.sources, [k]: e.target.checked })} />
      <span>{label}<small>{hint}</small></span>
    </label>
  );
  const head = (ico: string, title: string, sub: string) => (
    <div className="sec"><span className="ico" aria-hidden>{ico}</span><div><h2>{title}</h2><p>{sub}</p></div></div>
  );

  return (
    <>
      <h1>Settings</h1>
      <p className="lead">Change what the Monday digest looks for. No code, no redeploy.</p>
      {!editable && <div className="notice">Saving is switched off because no database is connected. You are viewing the defaults.</div>}

      <div className="card">
        {head("🎯", "What you care about", "These topics drive the ranking.")}
        <label htmlFor="focus">Focus areas <small>(one per line)</small></label>
        <textarea id="focus" value={txt.focus} onChange={(e) => setTxt({ ...txt, focus: e.target.value })} />
      </div>

      <div className="card">
        {head("📍", "Where", "Cities to watch. \"Bangalore\" and \"Bengaluru\" both work.")}
        <label htmlFor="cities">Target cities <small>(one per line)</small></label>
        <textarea id="cities" value={txt.cities} onChange={(e) => setTxt({ ...txt, cities: e.target.value })} />
        <label className="toggle" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={cfg.includeOnline} onChange={(e) => set("includeOnline", e.target.checked)} />
          <span>Include online events<small>Webinars and virtual summits</small></span>
        </label>
      </div>

      <div className="card">
        {head("📬", "Delivery & rules", "Who gets it, how far ahead, what counts as urgent.")}
        <label htmlFor="email">Send digest to</label>
        <input id="email" type="email" value={cfg.recipientEmail} onChange={(e) => set("recipientEmail", e.target.value)} />
        <div className="grid2">
          <div><label htmlFor="win">Look-ahead days</label><input id="win" type="number" value={cfg.windowDays} onChange={(e) => set("windowDays", Number(e.target.value))} /></div>
          <div><label htmlFor="urg">Flag deadlines within (days)</label><input id="urg" type="number" value={cfg.urgentDays} onChange={(e) => set("urgentDays", Number(e.target.value))} /></div>
          <div><label htmlFor="max">Max events in email</label><input id="max" type="number" value={cfg.maxEvents} onChange={(e) => set("maxEvents", Number(e.target.value))} /></div>
          <div><label htmlFor="min">Minimum match score (0-100)</label><input id="min" type="number" value={cfg.minScore} onChange={(e) => set("minScore", Number(e.target.value))} /></div>
        </div>
      </div>

      <div className="card">
        {head("🛰", "Sources", "Where Event Scout looks.")}
        <div className="toggles">
          {src("eventbrite", "Eventbrite", "Public event listings")}
          {src("rss", "Newsletters / RSS", "Feeds you add below")}
          {src("geminiSearch", "AI web search", "Conference sites, iSpirt, organiser pages")}
          {src("sample", "Sample data", "Demo events, turn off for real use")}
        </div>
        <label htmlFor="feeds">Newsletter / organiser feeds <small>(RSS or Atom URLs, one per line)</small></label>
        <textarea id="feeds" value={txt.feeds} onChange={(e) => setTxt({ ...txt, feeds: e.target.value })} />
      </div>

      <div className="savebar">
        <input id="tok" type="password" placeholder="Admin token" aria-label="Admin token" value={token} onChange={(e) => setToken(e.target.value)} />
        <button onClick={save} disabled={saving || !token || !editable}>{saving ? "Saving…" : "Save settings"}</button>
        {msg && <span className={`notice ${msg.ok ? "ok" : "err"}`} role="status" style={{ margin: 0 }}>{msg.text}</span>}
      </div>
    </>
  );
}
