import Papa from "papaparse";
import { useMemo, useState } from "react";
import { accountKey, type EnrichedTxn } from "../../core/aggregate";
import type { Kind } from "../../core/types";
import { useApp } from "../../state";
import { CategorySelect } from "../CategorySelect";
import { FilterBar, useFilters } from "../Filters";
import { accountLabel, fmtDate, money } from "../format";
import { href, seg, setParams, type Route } from "../router";

const KIND_SETS: Record<string, Kind[] | null> = {
  spend: ["purchase", "refund", "fee", "interest"],
  excluded: ["payment", "transfer", "deposit", "other"],
  all: null,
};

export function Transactions({ route }: { route: Route }) {
  const { enriched, groupBy, snapshot, updateRules } = useApp();
  const f = useFilters(route);
  const q = route.params.get("q") ?? "";
  const kindSet = route.params.get("kinds") ?? "spend";
  const [sort, setSort] = useState<{ key: "date" | "amount" | "merchant"; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [limit, setLimit] = useState(300);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState("");

  const rows = useMemo(() => {
    const kinds = KIND_SETS[kindSet] ? new Set(KIND_SETS[kindSet]) : null;
    const acc = new Set(f.accounts);
    const cat = new Set(f.categories);
    const needle = q.trim().toLowerCase();
    const out = enriched.filter(
      (t) =>
        (!kinds || kinds.has(t.kind)) &&
        t.date >= f.from &&
        t.date <= f.to &&
        (!acc.size || acc.has(accountKey(t, groupBy)) || acc.has(t.account)) &&
        (!cat.size || cat.has(t.category)) &&
        (!needle || t.rawDescription.toLowerCase().includes(needle) || t.merchant.toLowerCase().includes(needle) || String(t.amount).includes(needle)),
    );
    const k = sort.key;
    out.sort((a, z) => (k === "amount" ? a.amount - z.amount : k === "merchant" ? a.merchant.localeCompare(z.merchant) : a.date.localeCompare(z.date)) * sort.dir);
    return out;
  }, [enriched, kindSet, f.accounts, f.categories, f.from, f.to, q, sort, groupBy]);

  const total = rows.reduce((a, t) => a + (t.kind === "purchase" || t.kind === "refund" || t.kind === "fee" || t.kind === "interest" ? t.amount : 0), 0);

  const setOverride = (ids: string[], c: string) =>
    updateRules((r) => {
      const ov = { ...r.overrides };
      for (const id of ids) {
        if (c) ov[id] = c;
        else delete ov[id];
      }
      return { ...r, overrides: ov };
    });

  const exportCsv = () => {
    const data = rows.map((t: EnrichedTxn) => ({
      date: t.date,
      account: accountLabel(accountKey(t, groupBy), snapshot.rules),
      merchant: t.merchant,
      description: t.rawDescription,
      category: t.category,
      kind: t.kind,
      amount: t.amount,
    }));
    const blob = new Blob([Papa.unparse(data)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-${f.from}-to-${f.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const th = (key: typeof sort.key, label: string, cls = "") => (
    <th className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="th-btn" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "merchant" ? 1 : -1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  const allSel = rows.length > 0 && rows.slice(0, limit).every((r) => sel.has(r.id));

  return (
    <>
      <FilterBar route={route} f={f} />
      <div className="filters">
        <label className="field grow">
          <span>Search</span>
          <input type="search" value={q} placeholder="Merchant, description or amount" onChange={(e) => setParams(route, { q: e.target.value })} />
        </label>
        <label className="field">
          <span>Show</span>
          <select value={kindSet} onChange={(e) => setParams(route, { kinds: e.target.value === "spend" ? null : e.target.value })}>
            <option value="spend">Spending</option>
            <option value="excluded">Payments, transfers & other</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      {sel.size > 0 && (
        <div className="bulk">
          <strong>{sel.size} selected</strong>
          <CategorySelect label="Category for selected" value={bulk} includeAuto="Choose category…" onChange={setBulk} />
          <button
            disabled={!bulk}
            onClick={async () => {
              await setOverride([...sel], bulk);
              setSel(new Set());
              setBulk("");
            }}
          >
            Apply
          </button>
          <button
            className="link"
            onClick={async () => {
              await setOverride([...sel], "");
              setSel(new Set());
            }}
          >
            Reset to automatic
          </button>
          <button className="link" onClick={() => setSel(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <section className="card">
        <p className="note">
          {rows.length.toLocaleString()} transactions{kindSet !== "excluded" && <> · net spend {money(total)}</>}
        </p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th className="cb">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allSel}
                    onChange={(e) => setSel(e.target.checked ? new Set(rows.slice(0, limit).map((r) => r.id)) : new Set())}
                  />
                </th>
                {th("date", "Date")}
                {th("merchant", "Merchant")}
                <th className="hide-sm">{groupBy === "card" ? "Card" : "Account"}</th>
                <th>Category</th>
                {th("amount", "Amount", "num")}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id} className={r.kind === "payment" || r.kind === "transfer" || r.kind === "deposit" || r.kind === "other" ? "dim" : ""}>
                  <td className="cb">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.rawDescription}`}
                      checked={sel.has(r.id)}
                      onChange={(e) => {
                        const n = new Set(sel);
                        if (e.target.checked) n.add(r.id);
                        else n.delete(r.id);
                        setSel(n);
                      }}
                    />
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td>
                    <a href={href(`/merchant/${seg(r.merchant)}`, route.params)}>{r.merchant}</a>
                    <div className="sub">
                      {r.rawDescription}
                      {r.kind !== "purchase" && <span className="badge quiet">{r.kind}</span>}
                    </div>
                  </td>
                  <td className="hide-sm">{accountLabel(accountKey(r, groupBy), snapshot.rules)}</td>
                  <td>
                    <CategorySelect label="Category" value={snapshot.rules.overrides[r.id] ?? ""} includeAuto={snapshot.rules.overrides[r.id] ? "Automatic" : `Auto: ${r.category}`} onChange={(c) => setOverride([r.id], c)} />
                  </td>
                  <td className="num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <button className="link" onClick={() => setLimit((l) => l + 500)}>
            Show more ({(rows.length - limit).toLocaleString()} left)
          </button>
        )}
      </section>
    </>
  );
}
