import { useMemo, useState } from "react";
import { accountKey, kpis, seriesBy } from "../../core/aggregate";
import { useApp } from "../../state";
import { CategorySelect } from "../CategorySelect";
import { baseOption, Chart, useTokens } from "../Chart";
import { FilterBar, useFiltered, useFilters } from "../Filters";
import { accountLabel, fmtDate, money, money0, moneyCompact, monthLabel } from "../format";
import { go, href, seg, type Route } from "../router";

export function MerchantDetail({ route }: { route: Route }) {
  const name = route.segments[1] ?? "";
  const { groupBy, snapshot, updateRules, enriched } = useApp();
  const f = useFilters(route);
  const all = useFiltered(f, { ignoreCategories: true });
  const rows = useMemo(() => all.filter((t) => t.merchant === name).sort((a, z) => z.date.localeCompare(a.date)), [all, name]);
  const everRows = useMemo(() => enriched.filter((t) => t.merchant === name), [enriched, name]);
  const t = useTokens();
  const [rename, setRename] = useState("");

  const s = useMemo(() => seriesBy(rows, "category", "month", { from: f.from, to: f.to, groupBy }), [rows, f.from, f.to, groupBy]);
  const monthly = s.buckets.map((_, i) => s.series.reduce((a, x) => a + x.values[i], 0));
  const b = baseOption(t);
  const option = useMemo(
    () => ({
      backgroundColor: b.backgroundColor,
      textStyle: b.textStyle,
      grid: b.grid,
      tooltip: { ...b.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => money(v) },
      xAxis: { type: "category", data: s.buckets.map(monthLabel), ...b.xAxisBase },
      yAxis: { type: "value", ...b.yAxisBase, axisLabel: { ...b.yAxisBase.axisLabel, formatter: (v: number) => moneyCompact(v) } },
      series: [{ name, type: "bar", data: monthly, barMaxWidth: 24, itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] } }],
    }),
    [t, s.buckets, monthly.join()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const k = kpis(rows, f.from, f.to);
  const current = snapshot.rules.merchantCategories[name] ?? "";
  const cats = [...new Set(everRows.map((r) => r.category))];
  const back = new URLSearchParams(route.params);

  const setCategory = (c: string) =>
    updateRules((r) => {
      const mc = { ...r.merchantCategories };
      if (c) mc[name] = c;
      else delete mc[name];
      // A merchant-wide choice supersedes per-transaction overrides for this merchant.
      const ov = { ...r.overrides };
      for (const x of everRows) delete ov[x.id];
      return { ...r, merchantCategories: mc, overrides: ov };
    });

  const setOverride = (id: string, c: string) =>
    updateRules((r) => {
      const ov = { ...r.overrides };
      if (c) ov[id] = c;
      else delete ov[id];
      return { ...r, overrides: ov };
    });

  const doRename = async () => {
    const to = rename.trim();
    if (!to || to === name) return;
    await updateRules((r) => {
      const renames = { ...r.renames };
      // Re-point anything already renamed to this name, and the base name itself.
      for (const [k2, v] of Object.entries(renames)) if (v === name) renames[k2] = to;
      const base = Object.entries(r.renames).find(([, v]) => v === name)?.[0] ?? name;
      renames[base] = to;
      const mc = { ...r.merchantCategories };
      if (mc[name] && !mc[to]) mc[to] = mc[name];
      delete mc[name];
      return { ...r, renames, merchantCategories: mc };
    });
    setRename("");
    go(`/merchant/${seg(to)}`, back);
  };

  return (
    <>
      <nav className="crumbs">
        <a href={href("/", back)}>Overview</a> / {cats[0] && <a href={href(`/category/${seg(cats[0])}`, back)}>{cats[0]}</a>} / <span>{name}</span>
      </nav>
      <FilterBar route={route} f={f} showCategories={false} />
      <section className="kpis">
        <div className="kpi">
          <div className="kpi-label">{name}</div>
          <div className="kpi-value">{money0(k.total)}</div>
          <div className="kpi-sub">
            {k.count} charges · {money0(k.perMonth)}/month
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Category for every {name} charge</div>
          <CategorySelect label="Merchant category" value={current} includeAuto={`Automatic${cats.length === 1 ? ` (${cats[0]})` : ""}`} onChange={setCategory} />
          <div className="kpi-sub">Applies to past and future charges.</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rename or merge</div>
          <form
            className="inline"
            onSubmit={(e) => {
              e.preventDefault();
              void doRename();
            }}
          >
            <input value={rename} onChange={(e) => setRename(e.target.value)} placeholder="New name" aria-label="New merchant name" />
            <button type="submit" disabled={!rename.trim()}>
              Rename
            </button>
          </form>
          <div className="kpi-sub">Use an existing merchant’s name to merge them.</div>
        </div>
      </section>

      <section className="card">
        <h2>Monthly</h2>
        {rows.length ? <Chart label={`${name} spending per month`} option={option} height={240} /> : <p className="muted">No charges in this period.</p>}
      </section>

      <section className="card">
        <h2>Charges</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="hide-sm">{groupBy === "card" ? "Card" : "Account"}</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.date)}</td>
                <td className="sub-strong">{r.rawDescription}</td>
                <td className="hide-sm">{accountLabel(accountKey(r, groupBy), snapshot.rules)}</td>
                <td>
                  <CategorySelect label="Category for this charge" value={snapshot.rules.overrides[r.id] ?? ""} includeAuto={snapshot.rules.overrides[r.id] ? "Automatic" : `Auto: ${r.category}`} onChange={(c) => setOverride(r.id, c)} />
                </td>
                <td className="num">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
