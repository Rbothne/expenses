import { useMemo, useRef, useState } from "react";
import { BUILTIN_FORMATS, headerSignature, parseFile, type ParseOptions } from "../../core/parsers";
import type { ColumnMapping, FormatId, Kind } from "../../core/types";
import { useApp, type PendingImport } from "../../state";
import { bankLabel, fmtDate, money } from "../format";

const EXPORTS: { bank: string; url: string; steps: string }[] = [
  { bank: "Chase", url: "https://secure.chase.com/web/auth/dashboard#/dashboard/index/index", steps: "Open the card → download icon above the activity list → File type CSV → pick the date range (try the longest offered)." },
  { bank: "Amex", url: "https://global.americanexpress.com/activity?days=30&inav=myca_statements", steps: "Choose a date range → Download → CSV, and tick “Include all additional transaction details” (adds card member and category)." },
  { bank: "Capital One", url: "https://myaccounts.capitalone.com/accountSummary", steps: "Open the card → View transactions → Download Transactions → CSV → choose a date range." },
  { bank: "Discover", url: "https://www.discover.com/", steps: "Log in → Activity & Statements → All Activity → choose a period → Download → CSV." },
  { bank: "Schwab", url: "https://client.schwab.com/clientapps/accounts/summary/", steps: "Accounts → History → pick the checking account and a date range → Export → CSV." },
];

interface Item {
  key: string;
  fileName: string;
  text: string;
  opts: ParseOptions;
  include: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  purchase: "purchases",
  refund: "refunds",
  payment: "card payments (excluded)",
  transfer: "transfers (excluded)",
  fee: "fees",
  interest: "interest",
  deposit: "deposits (excluded)",
  other: "other (excluded)",
};

function MappingForm({ header, onSave, onCancel }: { header: string[]; onSave: (m: ColumnMapping) => void; onCancel: () => void }) {
  const guess = (re: RegExp) => header.find((h) => re.test(h)) ?? "";
  const [m, setM] = useState<ColumnMapping>({
    signature: headerSignature(header),
    label: "",
    account: "",
    date: guess(/date/i),
    description: guess(/desc|memo|payee|merchant|name/i),
    amount: guess(/amount|value/i) || undefined,
    debit: guess(/debit|withdraw/i) || undefined,
    credit: guess(/credit|deposit/i) || undefined,
    category: guess(/categ/i) || undefined,
    accountType: "card",
    sign: "out-negative",
  });
  const mode = m.amount ? "amount" : "split";
  const col = (k: keyof ColumnMapping, label: string, optional = false) => (
    <label className="field">
      <span>{label}</span>
      <select value={(m[k] as string) ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value || undefined })}>
        {optional && <option value="">(none)</option>}
        {!optional && <option value="">Choose…</option>}
        {header.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
  const valid = m.label.trim() && m.date && m.description && (mode === "amount" ? m.amount : m.debit || m.credit);
  return (
    <div className="mapping">
      <p>This file’s columns aren’t recognized. Tell me which is which once; files with the same columns will import automatically after this.</p>
      <div className="filters">
        <label className="field">
          <span>Account name</span>
          <input value={m.label} placeholder="e.g. Credit Union Visa" onChange={(e) => setM({ ...m, label: e.target.value, account: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} />
        </label>
        <label className="field">
          <span>Kind of account</span>
          <select value={m.accountType ?? "card"} onChange={(e) => setM({ ...m, accountType: e.target.value as "card" | "bank" })}>
            <option value="card">Credit card</option>
            <option value="bank">Bank account (checking/savings)</option>
          </select>
        </label>
        {col("date", "Date")}
        {col("description", "Description")}
        <label className="field">
          <span>Amounts are in</span>
          <select value={mode} onChange={(e) => setM(e.target.value === "amount" ? { ...m, amount: guess(/amount|value/i) || header[0], debit: undefined, credit: undefined } : { ...m, amount: undefined })}>
            <option value="amount">One amount column</option>
            <option value="split">Separate debit / credit columns</option>
          </select>
        </label>
        {mode === "amount" ? (
          <>
            {col("amount", "Amount")}
            <label className="field">
              <span>Purchases appear as</span>
              <select value={m.sign} onChange={(e) => setM({ ...m, sign: e.target.value as ColumnMapping["sign"] })}>
                <option value="out-negative">Negative numbers</option>
                <option value="out-positive">Positive numbers</option>
              </select>
            </label>
          </>
        ) : (
          <>
            {col("debit", "Debit (money out)", true)}
            {col("credit", "Credit (money in)", true)}
          </>
        )}
        {col("category", "Category", true)}
      </div>
      <div className="row">
        <button className="primary" disabled={!valid} onClick={() => onSave(m)}>
          Save mapping
        </button>
        <button className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Preview({ item, onChange, onRemove }: { item: Item; onChange: (i: Item) => void; onRemove: () => void }) {
  const { snapshot, updateRules } = useApp();
  const res = useMemo(() => parseFile(item.fileName, item.text, snapshot.rules, item.opts), [item, snapshot.rules]);
  const [mapping, setMapping] = useState(false);
  const kinds = useMemo(() => {
    const m = new Map<Kind, { n: number; sum: number }>();
    for (const r of res.rows) {
      const v = m.get(r.kind) ?? { n: 0, sum: 0 };
      v.n++;
      v.sum += r.amount;
      m.set(r.kind, v);
    }
    return [...m.entries()];
  }, [res]);
  const cards = [...new Set(res.rows.map((r) => r.cardKey))];
  const saved = snapshot.rules.columnMappings;
  const formatValue = item.opts.format ?? res.format ?? "";

  return (
    <div className={`preview ${res.format ? "" : "bad"}`}>
      <div className="preview-head">
        <div>
          <strong>{item.fileName}</strong>
          <div className="sub">
            {res.format ? (
              <>
                {res.rows.length} rows · {res.dateFrom && `${fmtDate(res.dateFrom)} – ${fmtDate(res.dateTo!)}`}
                {res.skipped ? ` · ${res.skipped} skipped (pending/totals/blank)` : ""}
              </>
            ) : (
              "Format not recognized"
            )}
          </div>
        </div>
        <div className="row">
          <label className="field">
            <span>Format</span>
            <select
              value={formatValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__map") setMapping(true);
                else onChange({ ...item, opts: { ...item.opts, format: (v || undefined) as FormatId | undefined } });
              }}
            >
              {!res.format && <option value="">Unknown</option>}
              {BUILTIN_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
              {saved.map((m) => (
                <option key={m.signature} value={`generic:${m.signature}`}>
                  {m.label}
                </option>
              ))}
              <option value="__map">Map columns manually…</option>
            </select>
          </label>
          <label className="field check">
            <input type="checkbox" checked={item.include} disabled={!res.format || !res.rows.length} onChange={(e) => onChange({ ...item, include: e.target.checked })} />
            <span>Import</span>
          </label>
          <button className="link" onClick={onRemove} aria-label={`Remove ${item.fileName}`}>
            Remove
          </button>
        </div>
      </div>

      {mapping || (!res.format && res.header.length > 0) ? (
        <MappingForm
          header={res.header}
          onCancel={() => setMapping(false)}
          onSave={async (m) => {
            await updateRules((r) => ({ ...r, columnMappings: [...r.columnMappings.filter((x) => x.signature !== m.signature), m] }));
            setMapping(false);
            onChange({ ...item, opts: { ...item.opts, format: `generic:${m.signature}`, mapping: m }, include: true });
          }}
        />
      ) : res.format ? (
        <>
          <div className="row wrap">
            <span className="pill">{bankLabel(res.account, snapshot.rules)}</span>
            {kinds.map(([k, v]) => (
              <span key={k} className="pill quiet">
                {v.n} {KIND_LABEL[k]} · {money(v.sum)}
              </span>
            ))}
          </div>
          {!res.cardDetected && (
            <div className="row">
              <label className="field">
                <span>Which card is this? (the file doesn’t say)</span>
                <input
                  value={item.opts.cardKey ?? ""}
                  placeholder={snapshot.rules.defaultCards[res.account] ?? "primary"}
                  onChange={(e) => onChange({ ...item, opts: { ...item.opts, cardKey: e.target.value.trim() || undefined } })}
                />
              </label>
              <span className="note">Last 4 digits or a short name. Leave blank if you only have one card at {bankLabel(res.account, snapshot.rules)}.</span>
            </div>
          )}
          {res.cardDetected && cards.length > 0 && <div className="note">Cards found: {cards.join(", ")}</div>}
          <table className="tbl compact">
            <tbody>
              {res.rows.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.rawDescription}</td>
                  <td>
                    <span className="badge quiet">{r.kind}</span>
                  </td>
                  <td className="num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">The file looks empty.</p>
      )}
    </div>
  );
}

export function Import() {
  const { snapshot, commitImports, removeImport, store, updateRules } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const next: Item[] = [];
    for (const f of Array.from(files)) {
      if (!/\.(csv|txt)$/i.test(f.name)) {
        next.push({ key: f.name + Math.random(), fileName: f.name, text: "", opts: {}, include: false });
        continue;
      }
      const text = await f.text();
      const res = parseFile(f.name, text, snapshot.rules);
      next.push({ key: f.name + f.lastModified + Math.random(), fileName: f.name, text, opts: {}, include: !!res.format && res.rows.length > 0 });
    }
    setItems((cur) => [...cur, ...next]);
    setDone(null);
  };

  const ready = items.filter((i) => i.include && i.text);

  const commit = async () => {
    setBusy(true);
    const pending: PendingImport[] = ready.map((i) => ({ fileName: i.fileName, text: i.text, result: parseFile(i.fileName, i.text, snapshot.rules, i.opts) })).filter((p) => p.result.format);
    // Remember the card typed for files without card info, per account.
    const defaults: Record<string, string> = {};
    for (const i of ready) if (i.opts.cardKey) defaults[parseFile(i.fileName, i.text, snapshot.rules, i.opts).account] = i.opts.cardKey;
    if (Object.keys(defaults).length) await updateRules((r) => ({ ...r, defaultCards: { ...r.defaultCards, ...defaults } }));
    const recs = await commitImports(pending);
    setBusy(false);
    if (recs.length) {
      const added = recs.reduce((a, r) => a + r.rowsAdded, 0);
      const skipped = recs.reduce((a, r) => a + r.rowsSkipped, 0);
      setDone(`Imported ${added.toLocaleString()} new transactions${skipped ? `; ${skipped.toLocaleString()} were already in your data` : ""}.`);
      setItems([]);
    }
  };

  return (
    <>
      <section className="card">
        <h2>Import bank exports</h2>
        <div
          className={`drop ${drag ? "on" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles(e.dataTransfer.files);
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        >
          <strong>Drop CSV files here</strong> or click to choose. Any bank, any filename, overlapping dates are fine.
          <input ref={input} type="file" accept=".csv,.CSV,text/csv" multiple hidden onChange={(e) => {
              const fl = e.target.files;
              if (fl) void addFiles(Array.from(fl));
              e.target.value = "";
            }} />
        </div>
        <p className="note">Files are read in your browser. Nothing is uploaded{store?.kind === "folder" ? "; a copy of each file is kept in your data folder under raw/." : "."}</p>

        {items.map((it) =>
          it.text ? (
            <Preview key={it.key} item={it} onChange={(n) => setItems((cur) => cur.map((x) => (x.key === it.key ? n : x)))} onRemove={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} />
          ) : (
            <div key={it.key} className="preview bad">
              <strong>{it.fileName}</strong> — only CSV files are supported right now.
            </div>
          ),
        )}
        {items.length > 0 && (
          <div className="row">
            <button className="primary" disabled={!ready.length || busy || !store} onClick={commit}>
              {busy ? "Importing…" : `Import ${ready.length} file${ready.length === 1 ? "" : "s"}`}
            </button>
            {!store && <span className="note">Choose where to keep data in Settings first.</span>}
          </div>
        )}
        {done && <p className="ok">{done}</p>}
      </section>

      <section className="card">
        <h2>Where to download</h2>
        <p className="note">Menus move around; these were the usual paths. Export the longest range each site allows. Download from all five, then drop everything here at once.</p>
        <ul className="exports">
          {EXPORTS.map((x) => (
            <li key={x.bank}>
              <a href={x.url} target="_blank" rel="noreferrer noopener">
                {x.bank}
              </a>
              <span>{x.steps}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Import history</h2>
        {snapshot.ledger.imports.length === 0 ? (
          <p className="muted">Nothing imported yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th className="hide-sm">Covers</th>
                <th className="num">Added</th>
                <th className="num hide-sm">Already had</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...snapshot.ledger.imports].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.at).toLocaleDateString()}</td>
                  <td>
                    {r.fileName}
                    <div className="sub">{bankLabel(r.account, snapshot.rules)}</div>
                  </td>
                  <td className="hide-sm">{r.dateFrom ? `${fmtDate(r.dateFrom)} – ${fmtDate(r.dateTo!)}` : ""}</td>
                  <td className="num">{r.rowsAdded}</td>
                  <td className="num hide-sm">{r.rowsSkipped}</td>
                  <td>
                    <button
                      className="link danger"
                      onClick={() => {
                        if (confirm(`Remove the ${r.rowsAdded} transactions added by ${r.fileName}?`)) void removeImport(r.id);
                      }}
                    >
                      Undo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

