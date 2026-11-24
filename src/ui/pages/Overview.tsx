import { useMemo } from "react";
import { accountKey, applyFilters, kpis, prevRange, seriesBy, totalsBy, type Dim, type EnrichedTxn } from "../../core/aggregate";
import { useApp } from "../../state";
import { baseOption, Chart, useTokens, type Tokens } from "../Chart";
import { FilterBar, useFiltered, useFilters } from "../Filters";
import { accountLabel, money, money0, moneyCompact, monthLabel, pct } from "../format";
import { foldSeries, OTHER_LABEL } from "../palette";
import { go, href, seg, setParams, type Route } from "../router";

export function useStableOrder(dim: Dim): string[] {
  const { enriched, groupBy } = useApp();
  return useMemo(
    () =>
      totalsBy(
        enriched.filter((t) => t.isSpend),
        dim,
        groupBy,
      ).map((x) => x.name),
    [enriched, groupBy, dim],
  );
}

export function colorOf(slot: number, t: Tokens) {
  return slot < 0 ? t.other : t.series[slot % t.series.length];
}

export function lineOption(t: Tokens, buckets: string[], series: ReturnType<typeof foldSeries>, label: (n: string) => string) {
  const b = baseOption(t);
  const direct = series.length <= 4;
  return {
    backgroundColor: b.backgroundColor,
    textStyle: b.textStyle,
    grid: { ...b.grid, right: direct ? 110 : 16, bottom: buckets.length > 24 ? 48 : 8, top: series.length > 1 ? 40 : 16 },
    legend: series.length > 1 ? { top: 0, left: 0, type: "scroll", icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: t.text2 }, pageTextStyle: { color: t.muted } } : undefined,
    tooltip: {
      ...b.tooltip,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.axis } },
      order: "valueDesc",
      valueFormatter: (v: number) => money0(v),
    },
    xAxis: { type: "category", data: buckets.map(monthLabel), boundaryGap: false, ...b.xAxisBase },
    yAxis: { type: "value", ...b.yAxisBase, axisLabel: { ...b.yAxisBase.axisLabel, formatter: (v: number) => moneyCompact(v) } },
    dataZoom: buckets.length > 24 ? [{ type: "slider", height: 18, bottom: 8, borderColor: t.grid, textStyle: { color: t.muted } }] : undefined,
    series: series.map((s) => ({
      name: s.name === OTHER_LABEL ? OTHER_LABEL : label(s.name),
      type: "line",
      data: s.values,
      showSymbol: buckets.length <= 1,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 2, type: s.slot < 0 ? "dashed" : "solid" },
      itemStyle: { color: colorOf(s.slot, t), borderColor: t.surface, borderWidth: 2 },
      emphasis: { focus: "series" },
      endLabel: direct ? { show: true, color: t.text2, formatter: "{a}", fontSize: 11 } : undefined,
      triggerLineEvent: true,
    })),
  };
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="muted">no prior period data</span>;
  const d = (now - before) / Math.abs(before);
  return (
    <span>
      {d >= 0 ? "▲" : "▼"} {pct(Math.abs(d))} vs prior period ({money0(before)})
    </span>
  );
}

function MiniStack({ rows, total, color }: { rows: { name: string; total: number }[]; total: number; color: (name: string) => string }) {
  const { snapshot } = useApp();
  if (total <= 0) return null;
  return (
    <div className="ministack" aria-hidden="true">
      {rows
        .filter((r) => r.total > 0)
        .map((r) => (
          <span key={r.name} title={`${accountLabel(r.name, snapshot.rules)}: ${money0(r.total)}`} style={{ width: `${(r.total / total) * 100}%`, background: color(r.name) }} />
        ))}
    </div>
  );
}

export function Overview({ route }: { route: Route }) {
  const { enriched, groupBy, snapshot } = useApp();
  const f = useFilters(route);
  const rows = useFiltered(f);
  const t = useTokens();
  const dim: Dim = route.params.get("view") === "account" ? "account" : "category";
  const order = useStableOrder(dim);
  const accOrder = useStableOrder("account");

  const label = (n: string) => (dim === "account" ? accountLabel(n, snapshot.rules) : n);
  const s = useMemo(() => seriesBy(rows, dim, f.bucket, { from: f.from, to: f.to, groupBy, rolling: f.rolling }), [rows, dim, f.bucket, f.from, f.to, groupBy, f.rolling]);
  const folded = useMemo(() => foldSeries(s, order), [s, order]);
  const option = useMemo(() => lineOption(t, s.buckets, folded, label), [t, s.buckets, folded]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = kpis(rows, f.from, f.to);
  const prev = prevRange(f.from, f.to);
  const prevRows = useMemo(() => applyFilters(enriched, { ...f, ...prev }, groupBy), [enriched, f, prev.from, prev.to, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const kPrev = kpis(prevRows, prev.from, prev.to);

  const totals = useMemo(() => totalsBy(rows, dim, groupBy), [rows, dim, groupBy]);
  const byAcct = useMemo(() => {
    const m = new Map<string, EnrichedTxn[]>();
    for (const r of rows) {
      const list = m.get(r.category);
      if (list) list.push(r);
      else m.set(r.category, [r]);
    }
    return m;
  }, [rows]);
  const slotOf = (name: string) => folded.find((x) => x.name === name)?.slot ?? -1;

  if (!enriched.length) {
    return (
      <div className="empty">
        <h2>No transactions yet</h2>
        <p>
          Export CSVs from your banks and drop them on the <a href={href("/import")}>Import</a> page.
        </p>
      </div>
    );
  }

  return (
    <>
      <FilterBar route={route} f={f} showBucket />
      <section className="kpis">
        <Kpi label="Total spend" value={money0(k.total)} sub={<Delta now={k.total} before={kPrev.total} />} />
        <Kpi label="Per month" value={money0(k.perMonth)} sub={`${k.months} month${k.months === 1 ? "" : "s"}`} />
        <Kpi label="Purchases" value={k.count.toLocaleString()} sub={k.count ? `avg ${money(k.total / k.count)}` : undefined} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Spending over time</h2>
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={dim === "category"} onClick={() => setParams(route, { view: null })}>
              By category
            </button>
            <button role="tab" aria-selected={dim === "account"} onClick={() => setParams(route, { view: "account" })}>
              By {groupBy === "card" ? "card" : "account"}
            </button>
          </div>
        </div>
        {folded.length ? (
          <Chart
            label={`Line chart of spending by ${dim} per ${f.bucket}`}
            option={option}
            height={380}
            onClick={(p) => {
              if (dim === "category" && p.seriesName && p.seriesName !== OTHER_LABEL) go(`/category/${seg(p.seriesName)}`, route.params);
            }}
          />
        ) : (
          <p className="muted">No spending in this period.</p>
        )}
        {folded.some((x) => x.slot < 0) && <p className="note">Smaller {dim === "category" ? "categories" : "accounts"} are combined as “{OTHER_LABEL}”. Use the filter above to chart specific ones.</p>}
      </section>

      <section className="card">
        <h2>{dim === "category" ? "Categories" : groupBy === "card" ? "Cards" : "Accounts"}</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>{dim === "category" ? "Category" : "Account"}</th>
              <th className="num">Total</th>
              <th className="num">Share</th>
              <th className="num hide-sm">Per month</th>
              <th className="num hide-sm">Purchases</th>
              {dim === "category" && <th className="hide-sm">By {groupBy === "card" ? "card" : "account"}</th>}
            </tr>
          </thead>
          <tbody>
            {totals.map((r) => {
              const sub = dim === "category" ? totalsBy(byAcct.get(r.name) ?? [], "account", groupBy).sort((a, z) => accOrder.indexOf(a.name) - accOrder.indexOf(z.name)) : [];
              return (
                <tr key={r.name}>
                  <td>
                    <span className="swatch" style={{ background: colorOf(slotOf(r.name), t) }} />
                    {dim === "category" ? (
                      <a href={href(`/category/${seg(r.name)}`, route.params)}>{r.name}</a>
                    ) : (
                      <a href={href("/", new URLSearchParams({ ...Object.fromEntries(route.params), acc: r.name, view: "category" }))}>{label(r.name)}</a>
                    )}
                  </td>
                  <td className="num">{money0(r.total)}</td>
                  <td className="num">{pct(r.share)}</td>
                  <td className="num hide-sm">{money0(r.total / k.months)}</td>
                  <td className="num hide-sm">{r.count}</td>
                  {dim === "category" && (
                    <td className="hide-sm">
                      <MiniStack rows={sub.map((x) => ({ name: x.name, total: x.total }))} total={r.total} color={(n) => t.series[Math.max(0, accOrder.indexOf(n)) % 8]} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {dim === "category" && <AccountLegend t={t} names={accOrder.filter((a) => rows.some((r) => accountKey(r, groupBy) === a))} />}
      </section>
    </>
  );
}

function AccountLegend({ names, t }: { names: string[]; t: Tokens }) {
  const { snapshot } = useApp();
  const accOrder = useStableOrder("account");
  return (
    <div className="legend hide-sm">
      {names.map((n) => (
        <span key={n}>
          <span className="swatch" style={{ background: t.series[accOrder.indexOf(n) % 8] }} />
          {accountLabel(n, snapshot.rules)}
        </span>
      ))}
    </div>
  );
}
