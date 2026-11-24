import { useMemo, useState } from "react";
import { CE_RELEASE, CE_YEAR, COUNTRIES, COUNTRY_META, compareToGroup, countryShares, CPI_LATEST, defaultGroupId, type BenchRow } from "../../../core/benchmarks";
import { fullMonths } from "../../../core/range";
import { useApp } from "../../../state";
import { fmtDate, money0, pct } from "../../format";
import { href, seg } from "../../router";

const signedPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p * 100).toFixed(0)}%`;

/** You vs the survey group on one scale; identity is in the column headers, not just the colors. */
function Pair({ you, them, max }: { you: number; them: number; max: number }) {
  const w = (v: number) => `${max ? Math.min(100, (v / max) * 100) : 0}%`;
  return (
    <div className="pair" aria-hidden="true">
      <span className="you" style={{ width: w(you) }} />
      <span className="them" style={{ width: w(them) }} />
    </div>
  );
}

export function Benchmarks() {
  const { enriched, snapshot, earliest, latest } = useApp();
  const p = snapshot.rules.profile;
  const win = fullMonths(latest, earliest, 12);
  const spend = useMemo(() => enriched.filter((t) => t.isSpend), [enriched]);
  const res = useMemo(() => compareToGroup(spend, win, defaultGroupId(p), p.tenure ?? "rent"), [spend, win.from, win.to, p.benchmarkGroup, p.householdSize, p.tenure]); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState("USA");
  const shares = useMemo(() => countryShares(spend.filter((t) => t.date >= win.from && t.date <= win.to), country), [spend, win.from, win.to, country]);
  if (!enriched.length) return null;

  // $0 here almost always means "paid some other way" (HSA, payroll, cash), not "spends nothing"; don't score it.
  const comparable = res.rows.filter((x) => x.them != null && x.you > 0);
  const untracked = res.rows.filter((x) => x.them != null && x.you <= 0);
  const context = res.rows.filter((x) => !x.comparable && x.context.length);
  const missing = res.rows.filter((x) => x.missing);
  const max = Math.max(0, ...comparable.flatMap((x) => [x.you, x.them!]));
  const g = res.group;
  const latestMonth = new Date(CPI_LATEST.period + "-01T00:00:00Z").toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const dollars = win.to.slice(0, 4) > String(CE_YEAR) ? `${latestMonth} dollars (approx.)` : `${win.to.slice(0, 4)} dollars`;
  const label = (x: BenchRow) => <a href={href(`/category/${seg(x.category)}`)}>{x.category}</a>;
  const sizeHint = !p.householdSize && !p.benchmarkGroup;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Compared with the average household</h2>
          <span className="muted">
            Per year, {fmtDate(win.from)} – {fmtDate(win.to)}
            {res.annualized && ` (${res.months} months, scaled to a year)`}
          </span>
        </div>
        <p className="note">
          Against <strong>{g.label}</strong>
          {g.kind === "size" || g.kind === "all" ? ` (${g.persons} people on average)` : ""}, from the BLS Consumer Expenditure Survey{" "}
          {g.period ? `${g.period} two-year average` : `${CE_YEAR} (released ${CE_RELEASE})`}, inflation-adjusted to {dollars}.
          {g.period && " Smaller sample, older data: read it as a ballpark."}
          {sizeHint && <> Set household size under “About you” for a closer match.</>}
        </p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">You</th>
                <th className="num">Average</th>
                <th className="num">Difference</th>
                <th className="hide-sm" style={{ width: "26%" }}>
                  <span className="legend-inline">
                    <span className="sw you" /> you <span className="sw them" /> average
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {comparable.map((x) => (
                <tr key={x.category} title={[x.note, x.groupNote].filter(Boolean).join(" ")}>
                  <td>
                    {label(x)}
                    {x.groupNote && <div className="sub">{x.groupNote}</div>}
                  </td>
                  <td className="num">{money0(x.you)}</td>
                  <td className="num">{money0(x.them!)}</td>
                  <td className="num">
                    <span className="chg">
                      {x.delta! >= 0 ? "+" : "−"}
                      {money0(Math.abs(x.delta!))}
                      {x.pct != null && x.them! >= 100 && <> ({signedPct(x.pct)})</>}
                    </span>
                  </td>
                  <td className="hide-sm">
                    <Pair you={x.you} them={x.them!} max={max} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Only categories that line up with a survey line are compared. Hover a row for what's in it. Survey figures are averages (means) over all households in the group, including ones that spent nothing on that line, so a big spender or two pulls them up; they aren't what a “typical” household spends.{!g.period && " The 2025 survey couldn't collect data in October and November 2025 (federal funding lapse); BLS reweighted to cover the gap."}
          {missing.length > 0 && <> Not published for this area: {missing.map((x) => x.category).join(", ")}.</>}
          {untracked.length > 0 && <> Nothing tracked for {untracked.map((x) => `${x.category} (average ${money0(x.them!)})`).join(", ")}, so they're left out; if you pay for these some other way, that's why.</>}
        </p>
        {context.length > 0 && (
          <details>
            <summary>Categories that don't line up (for context)</summary>
            <ul className="ctx">
              {context.map((x) => (
                <li key={x.category}>
                  <strong>{x.category}</strong>: you {money0(x.you)}/yr. The survey has no matching line; nearest: {x.context.map((c) => `${c.label} ${money0(c.value)}`).join(", ")}. <span className="muted">{x.note}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {COUNTRIES.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Fun facts: where the money goes, by country</h2>
            <label className="field">
              <span>Country</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.iso3} value={c.iso3}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Share of spending</th>
                <th className="num">You</th>
                <th className="num">{COUNTRIES.find((c) => c.iso3 === country)?.name}</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={s.group}>
                  <td>{s.label}</td>
                  <td className="num">{pct(s.you)}</td>
                  <td className="num">{pct(s.them)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            OECD household consumption shares, {COUNTRY_META.year}. Not like-for-like: national figures include things no bank export shows (imputed rent for owners, health care paid by insurers and government), so treat this as a curiosity, not a target.{" "}
            <a href="https://www.oecd.org/" target="_blank" rel="noreferrer noopener">
              OECD
            </a>
          </p>
        </section>
      )}
    </>
  );
}
