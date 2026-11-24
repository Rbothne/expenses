import { useMemo, useState } from "react";
import { accountKey, kpis, seriesBy, topMerchants, topPurchases } from "../../core/aggregate";
import { useApp } from "../../state";
import { Chart, useTokens } from "../Chart";
import { FilterBar, useFiltered, useFilters } from "../Filters";
import { accountLabel, fmtDate, money, money0, pct } from "../format";
import { foldSeries } from "../palette";
import { href, seg, type Route } from "../router";
import { lineOption, useStableOrder } from "./Overview";

export function CategoryDetail({ route }: { route: Route }) {
  const name = route.segments[1] ?? "";
  const { groupBy, snapshot } = useApp();
  const f = useFilters(route);
  const all = useFiltered(f, { ignoreCategories: true });
  const rows = useMemo(() => all.filter((t) => t.category === name), [all, name]);
  const t = useTokens();
  const accOrder = useStableOrder("account");
  const [n, setN] = useState(5);

  const s = useMemo(() => seriesBy(rows, "account", f.bucket, { from: f.from, to: f.to, groupBy, rolling: f.rolling }), [rows, f.bucket, f.from, f.to, groupBy, f.rolling]);
  const folded = useMemo(() => foldSeries(s, accOrder), [s, accOrder]);
  const option = useMemo(() => lineOption(t, s.buckets, folded, (x) => accountLabel(x, snapshot.rules)), [t, s.buckets, folded, snapshot.rules]);

  const k = kpis(rows, f.from, f.to);
  const allTotal = all.reduce((a, x) => a + x.amount, 0);
  const merchants = useMemo(() => topMerchants(rows, 25), [rows]);
  const purchases = useMemo(() => topPurchases(rows, 5), [rows]);
  const back = new URLSearchParams(route.params);

  return (
    <>
      <nav className="crumbs">
        <a href={href("/", back)}>Overview</a> / <span>{name}</span>
      </nav>
      <FilterBar route={route} f={f} showCategories={false} showBucket />
      <section className="kpis">
        <div className="kpi">
          <div className="kpi-label">{name}</div>
          <div className="kpi-value">{money0(k.total)}</div>
          <div className="kpi-sub">{allTotal ? `${pct(k.total / allTotal)} of all spending` : ""}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Per month</div>
          <div className="kpi-value">{money0(k.perMonth)}</div>
          <div className="kpi-sub">{k.count} purchases</div>
        </div>
      </section>

      <section className="card">
        <h2>Top merchants</h2>
        <p className="note">Repeat charges are added together, so a regular habit and a one-off big purchase both show up.</p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Merchant</th>
              <th className="num">Total</th>
              <th className="num">Share</th>
              <th className="num hide-sm">Charges</th>
              <th className="num hide-sm">Average</th>
              <th className="num hide-sm">Largest</th>
            </tr>
          </thead>
          <tbody>
            {merchants.slice(0, n).map((m) => (
              <tr key={m.merchant}>
                <td>
                  <a href={href(`/merchant/${seg(m.merchant)}`, back)}>{m.merchant}</a>
                  {m.recurring ? <span className="badge" title={`Charged in ${m.months} different months`}>recurring</span> : m.count === 1 ? <span className="badge quiet">one-off</span> : null}
                </td>
                <td className="num">{money0(m.total)}</td>
                <td className="num">
                  <span className="sharebar">
                    <span style={{ width: `${Math.max(0, Math.min(1, m.share)) * 100}%` }} />
                  </span>
                  {pct(m.share)}
                </td>
                <td className="num hide-sm">{m.count}</td>
                <td className="num hide-sm">{money(m.avg)}</td>
                <td className="num hide-sm">{money(m.largest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {merchants.length > n && (
          <button className="link" onClick={() => setN(25)}>
            Show top 25
          </button>
        )}
        {!merchants.length && <p className="muted">No spending in this category for the period.</p>}
      </section>

      <section className="card">
        <h2>Largest single purchases</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th className="hide-sm">{groupBy === "card" ? "Card" : "Account"}</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.date)}</td>
                <td>
                  <a href={href(`/merchant/${seg(p.merchant)}`, back)}>{p.merchant}</a>
                  <div className="sub">{p.rawDescription}</div>
                </td>
                <td className="hide-sm">{accountLabel(accountKey(p, groupBy), snapshot.rules)}</td>
                <td className="num">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>{name} over time</h2>
        {folded.length ? <Chart label={`${name} spending over time by account`} option={option} height={320} /> : <p className="muted">No data.</p>}
      </section>
    </>
  );
}
