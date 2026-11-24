import { useMemo } from "react";
import { accountKey, applyFilters } from "../../core/aggregate";
import { comparisonRange, coverageGaps, deltas, insights, materiality, yearly, type CompareMode, type Delta, type Insight } from "../../core/compare";
import { useApp } from "../../state";
import { FilterBar, useFiltered, useFilters } from "../Filters";
import { accountLabel, fmtDate, money0, money } from "../format";
import { href, seg, setParams, type Route } from "../router";
import { Benchmarks } from "./insights/Benchmarks";
import { HealthCheck } from "./insights/HealthCheck";

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money0(Math.abs(n))}`;
const signedPct = (p: number | null) => (p == null ? "" : `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(Math.abs(p) < 0.1 ? 1 : 0)}%`);
const span = (r: { from: string; to: string }) => `${fmtDate(r.from)} – ${fmtDate(r.to)}`;

function Change({ d, pctToo = true }: { d: { delta: number; pct: number | null }; pctToo?: boolean }) {
  return (
    <span className={d.delta > 0 ? "chg up" : d.delta < 0 ? "chg down" : "chg"}>
      {d.delta > 0 ? "▲" : d.delta < 0 ? "▼" : ""} {signed(d.delta)}
      {pctToo && d.pct != null && <> ({signedPct(d.pct)})</>}
    </span>
  );
}

function Sentence({ i, route }: { i: Insight; route: Route }) {
  const cat = (k: string) => <a href={href(`/category/${seg(k)}`, route.params)}>{k}</a>;
  const mer = (k: string) => <a href={href(`/merchant/${seg(k)}`, route.params)}>{k}</a>;
  switch (i.type) {
    case "total":
      return null;
    case "category":
      return (
        <li>
          {cat(i.key)} <Change d={i} />
          {i.driver && (
            <>
              {" "}
              — {Math.abs(i.driver.delta) >= Math.abs(i.delta) * 0.7 ? "mostly" : "largely"} {mer(i.driver.key)} ({signed(i.driver.delta)})
            </>
          )}
        </li>
      );
    case "merchant":
      return (
        <li>
          {mer(i.key)} <Change d={i} />
        </li>
      );
    case "new":
      return (
        <li>
          <span className="badge quiet">New</span> {mer(i.key)}, {money0(i.cur)} — nothing there in the earlier period
        </li>
      );
    case "gone":
      return (
        <li>
          <span className="badge quiet">Stopped</span> {mer(i.key)} — {money(i.prev)} over {i.months} months before, nothing since
        </li>
      );
    case "price":
      return (
        <li>
          <span className="badge quiet">Price</span> {mer(i.key)} went from {money(i.before)} to {money(i.after)} per charge ({signedPct(i.pct)})
        </li>
      );
  }
}

/** Horizontal change bar: blue left for less spending, red right for more; the sign is also in the text. */
function DeltaBar({ d, max }: { d: Delta; max: number }) {
  const w = max ? (Math.abs(d.delta) / max) * 50 : 0;
  return (
    <div className="dbar" aria-hidden="true">
      <span className={d.delta < 0 ? "neg" : "pos"} style={d.delta < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
    </div>
  );
}

export function Insights({ route }: { route: Route }) {
  const { enriched, groupBy, snapshot, earliest, latest } = useApp();
  const f = useFilters(route, "12m");
  const mode: CompareMode = route.params.get("vs") === "prev" ? "prev" : "yoy";
  const cur = useFiltered(f);
  const before = comparisonRange(f, mode);
  const prev = useMemo(() => applyFilters(enriched, { ...f, ...before }, groupBy), [enriched, f, before.from, before.to, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => insights(cur, prev), [cur, prev]);
  const total = list[0] as Extract<Insight, { type: "total" }>;
  const cats = useMemo(() => deltas(cur, prev, (t) => t.category), [cur, prev]);
  const maxCat = Math.max(0, ...cats.map((c) => Math.abs(c.delta)));

  const gaps = useMemo(() => {
    const scope = f.accounts.length ? enriched.filter((t) => f.accounts.includes(accountKey(t, groupBy)) || f.accounts.includes(t.account)) : enriched;
    return coverageGaps(scope, { from: before.from, to: f.to }, groupBy);
  }, [enriched, f.accounts, groupBy, before.from, f.to]);
  const noEarlier = before.to < earliest;

  const allSpend = useMemo(() => applyFilters(enriched, { accounts: f.accounts, categories: f.categories }, groupBy), [enriched, f.accounts, f.categories, groupBy]);
  const years = useMemo(() => yearly(allSpend, earliest, latest), [allSpend, earliest, latest]);

  if (!enriched.length)
    return (
      <div className="empty">
        <h2>No transactions yet</h2>
        <p>
          Import some exports on the <a href={href("/import")}>Import</a> page first.
        </p>
      </div>
    );

  const sentences = list.filter((i) => i.type !== "total");
  const floor = materiality(total.prev);

  return (
    <>
      <FilterBar route={route} f={f}>
        <label className="field">
          <span>Compare to</span>
          <select value={mode} onChange={(e) => setParams(route, { vs: e.target.value === "yoy" ? null : e.target.value })}>
            <option value="yoy">Same dates a year earlier</option>
            <option value="prev">The period just before</option>
          </select>
        </label>
      </FilterBar>

      <section className="card">
        <div className="card-head">
          <h2>What changed</h2>
          <span className="muted">
            {span(f)} vs {span(before)}
          </span>
        </div>
        {noEarlier ? (
          <p>
            Your data starts {fmtDate(earliest)}, so there's nothing to compare against for {span(before)} yet. Import older exports, or compare to the period just before.
          </p>
        ) : (
          <>
            <p className="lead">
              You spent <strong>{money0(total.cur)}</strong>, <Change d={total} /> from {money0(total.prev)}.
            </p>
            {gaps.length > 0 && (
              <div className="callout" role="note">
                <strong>Partly missing data.</strong> {gaps.map((g) => `${accountLabel(g.account, snapshot.rules)} (${fmtDate(g.first)} – ${fmtDate(g.last)})`).join(", ")}{" "}
                {gaps.length === 1 ? "doesn't" : "don't"} cover both periods, so some of the change is imports, not spending. Import the missing months to fix it.
              </div>
            )}
            {sentences.length ? <ul className="insights">{sentences.map((i) => <Sentence key={i.type + i.key} i={i} route={route} />)}</ul> : <p className="muted">Nothing moved by {money0(floor)} or more.</p>}
            <p className="note">Listed: changes of at least {money0(floor)} (the larger of $50 and 2% of the earlier period's spending), or at least $100 and 25%. Refunds count against what they refunded.</p>
          </>
        )}
      </section>

      {!noEarlier && cats.length > 0 && (
        <section className="card">
          <h2>By category</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Earlier</th>
                  <th className="num">Now</th>
                  <th className="num">Change</th>
                  <th className="hide-sm" style={{ width: "28%" }}>
                    <span className="sr-only">Change, drawn</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <a href={href(`/category/${seg(c.key)}`, route.params)}>{c.key}</a>
                    </td>
                    <td className="num">{money0(c.prev)}</td>
                    <td className="num">{money0(c.cur)}</td>
                    <td className="num">
                      <Change d={c} />
                    </td>
                    <td className="hide-sm">
                      <DeltaBar d={c} max={maxCat} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Bars: left (blue) is less spending, right (red) is more.</p>
        </section>
      )}

      {years.years.length > 1 && (
        <section className="card">
          <h2>Year by year</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Category</th>
                  {years.years.map((y) => (
                    <th key={y.year} className="num" title={y.partial ? `Partial: ${span(y)}` : undefined}>
                      {y.year}
                      {y.partial && "*"}
                    </th>
                  ))}
                  {years.ytdValid && <th className="num">This year so far</th>}
                </tr>
              </thead>
              <tbody>
                {years.rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <a href={href(`/category/${seg(r.key)}`, route.params)}>{r.key}</a>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className={years.years[i].partial ? "num muted" : "num"}>
                        {money0(v)}
                      </td>
                    ))}
                    {years.ytdValid && <td className="num">{r.ytdPct == null ? (r.ytdPrev < 25 && r.ytdCur > 0 ? <span className="muted">new</span> : "—") : <Change d={{ delta: r.ytdCur - r.ytdPrev, pct: r.ytdPct }} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            * Partial year ({years.years.filter((y) => y.partial).map((y) => `${y.year}: ${span(y)}`).join("; ")}) — don't compare its total with a full year.
            {years.ytdValid && <> “This year so far” compares {span({ from: `${latest.slice(0, 4)}-01-01`, to: latest })} with the same dates in {+latest.slice(0, 4) - 1}.</>}
          </p>
        </section>
      )}

      <HealthCheck />
      <Benchmarks />
    </>
  );
}
