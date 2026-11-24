import { useMemo, useState } from "react";
import { mapIssuerCategory } from "../../core/categories";
import type { Rules as R } from "../../core/types";
import { useApp } from "../../state";
import { CategorySelect } from "../CategorySelect";
import { bankLabel } from "../format";
import { href, seg } from "../router";

function safeRe(p: string): RegExp | null {
  try {
    return new RegExp(p, "i");
  } catch {
    return null;
  }
}

function PatternList({ title, help, items, onChange, field }: { title: string; help: string; items: string[]; onChange: (fn: (cur: string[]) => string[]) => void; field: "transfer" | "payment" }) {
  const { enriched } = useApp();
  const [draft, setDraft] = useState("");
  const count = (p: string) => {
    const re = safeRe(p);
    if (!re) return "invalid";
    const n = enriched.filter((t) => (field === "transfer" ? t.amount > 0 && t.account === "schwab" : t.amount < 0) && re.test(t.rawDescription)).length;
    return `${n} match${n === 1 ? "" : "es"}`;
  };
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="note">{help}</p>
      <ul className="rules">
        {items.map((p, i) => (
          <li key={i}>
            <code>{p}</code>
            <span className="muted">{count(p)}</span>
            <button className="link danger" onClick={() => onChange((cur) => cur.filter((x) => x !== p))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && safeRe(draft)) {
            {
            const v = draft.trim();
            onChange((cur) => (cur.includes(v) ? cur : [...cur, v]));
          }
            setDraft("");
          }
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Text or regular expression" aria-label={`Add ${title} pattern`} />
        <button type="submit" disabled={!draft.trim() || !safeRe(draft)}>
          Add
        </button>
        {draft && <span className="muted">{safeRe(draft) ? count(draft) : "invalid pattern"}</span>}
      </form>
    </section>
  );
}

export function Rules() {
  const { snapshot, updateRules, enriched } = useApp();
  const rules = snapshot.rules;
  const set = (patch: (r: R) => Partial<R>) => updateRules((r) => ({ ...r, ...patch(r) }));
  const [desc, setDesc] = useState({ pattern: "", category: "" });
  const [alias, setAlias] = useState({ pattern: "", merchant: "" });
  const [newCat, setNewCat] = useState("");

  const issuerCats = useMemo(() => {
    const m = new Map<string, { account: string; cat: string; n: number }>();
    for (const t of enriched) {
      if (!t.issuerCategory || !t.isSpend) continue;
      const k = `${t.account}:${t.issuerCategory}`.toLowerCase();
      const v = m.get(k) ?? { account: t.account, cat: t.issuerCategory, n: 0 };
      v.n++;
      m.set(k, v);
    }
    return [...m.entries()].sort((a, z) => a[1].account.localeCompare(z[1].account) || z[1].n - a[1].n);
  }, [enriched]);

  const descCount = (p: string) => {
    const re = safeRe(p);
    return re ? enriched.filter((t) => re.test(t.rawDescription)).length : 0;
  };

  return (
    <>
      <section className="card">
        <h2>Categories</h2>
        <p className="note">Rename by removing and re-adding; merchants and transactions pointing at a removed category fall back to automatic.</p>
        <div className="row wrap">
          {rules.categories.map((c) => (
            <span key={c} className="pill">
              {c}
              {c !== "Other" && (
                <button
                  className="x"
                  aria-label={`Remove ${c}`}
                  onClick={() => {
                    if (!confirm(`Remove category “${c}”?`)) return;
                    void updateRules((r) => ({
                      ...r,
                      categories: r.categories.filter((x) => x !== c),
                      merchantCategories: Object.fromEntries(Object.entries(r.merchantCategories).filter(([, v]) => v !== c)),
                      overrides: Object.fromEntries(Object.entries(r.overrides).filter(([, v]) => v !== c)),
                      descriptionRules: r.descriptionRules.filter((d) => d.category !== c),
                    }));
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            const c = newCat.trim();
            if (c && !rules.categories.includes(c)) void set((r) => ({ categories: r.categories.includes(c) ? r.categories : [...r.categories.filter((x) => x !== "Other"), c, "Other"] }));
            setNewCat("");
          }}
        >
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" aria-label="New category" />
          <button type="submit" disabled={!newCat.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Merchant categories</h2>
        <p className="note">Set from any merchant page. These win over the bank’s own category.</p>
        {Object.keys(rules.merchantCategories).length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="rules">
            {Object.entries(rules.merchantCategories)
              .sort()
              .map(([m, c]) => (
                <li key={m}>
                  <a href={href(`/merchant/${seg(m)}`)}>{m}</a>
                  <span>→ {c}</span>
                  <button
                    className="link danger"
                    onClick={() =>
                      updateRules((r) => {
                        const mc = { ...r.merchantCategories };
                        delete mc[m];
                        return { ...r, merchantCategories: mc };
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Description rules</h2>
        <p className="note">Any transaction whose description matches goes to the category. Useful for things like “VENMO.*RENT”.</p>
        <ul className="rules">
          {rules.descriptionRules.map((d, i) => (
            <li key={i}>
              <code>{d.pattern}</code>
              <span>→ {d.category}</span>
              <span className="muted">{descCount(d.pattern)} matches</span>
              <button className="link danger" onClick={() => set((r) => ({ descriptionRules: r.descriptionRules.filter((x) => !(x.pattern === d.pattern && x.category === d.category)) }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (desc.pattern && desc.category && safeRe(desc.pattern)) {
              {
              const add = desc;
              void set((r) => ({ descriptionRules: [...r.descriptionRules, add] }));
            }
              setDesc({ pattern: "", category: "" });
            }
          }}
        >
          <input value={desc.pattern} onChange={(e) => setDesc({ ...desc, pattern: e.target.value })} placeholder="Pattern" aria-label="Description pattern" />
          <CategorySelect label="Category" value={desc.category} includeAuto="Category…" onChange={(c) => setDesc({ ...desc, category: c })} />
          <button type="submit" disabled={!desc.pattern || !desc.category || !safeRe(desc.pattern)}>
            Add
          </button>
          {desc.pattern && <span className="muted">{safeRe(desc.pattern) ? `${descCount(desc.pattern)} matches` : "invalid"}</span>}
        </form>
      </section>

      <section className="card">
        <h2>Merchant aliases &amp; renames</h2>
        <p className="note">An alias turns any description matching a pattern into a merchant name. Renames are made from merchant pages.</p>
        <ul className="rules">
          {rules.aliases.map((a, i) => (
            <li key={i}>
              <code>{a.pattern}</code>
              <span>→ {a.merchant}</span>
              <span className="muted">{descCount(a.pattern)} matches</span>
              <button className="link danger" onClick={() => set((r) => ({ aliases: r.aliases.filter((x) => !(x.pattern === a.pattern && x.merchant === a.merchant)) }))}>
                Remove
              </button>
            </li>
          ))}
          {Object.entries(rules.renames).map(([from, to]) => (
            <li key={from}>
              <span>{from}</span>
              <span>→ {to}</span>
              <button
                className="link danger"
                onClick={() =>
                  updateRules((r) => {
                    const rn = { ...r.renames };
                    delete rn[from];
                    return { ...r, renames: rn };
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (alias.pattern && alias.merchant && safeRe(alias.pattern)) {
              {
              const add = alias;
              void set((r) => ({ aliases: [...r.aliases, add] }));
            }
              setAlias({ pattern: "", merchant: "" });
            }
          }}
        >
          <input value={alias.pattern} onChange={(e) => setAlias({ ...alias, pattern: e.target.value })} placeholder="Pattern" aria-label="Alias pattern" />
          <input value={alias.merchant} onChange={(e) => setAlias({ ...alias, merchant: e.target.value })} placeholder="Merchant name" aria-label="Alias merchant" />
          <button type="submit" disabled={!alias.pattern || !alias.merchant || !safeRe(alias.pattern)}>
            Add
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Bank categories</h2>
        <p className="note">How each bank’s own label maps to your categories. Only used when no merchant or description rule applies.</p>
        {issuerCats.length === 0 ? (
          <p className="muted">Import some data first.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bank</th>
                <th>Bank’s label</th>
                <th className="num">Txns</th>
                <th>Your category</th>
              </tr>
            </thead>
            <tbody>
              {issuerCats.map(([k, v]) => {
                const user = rules.issuerCategoryMap[k];
                const auto = mapIssuerCategory(v.account, v.cat, { ...rules, issuerCategoryMap: {} }) ?? "Other";
                return (
                  <tr key={k}>
                    <td>{bankLabel(v.account, rules)}</td>
                    <td>{v.cat}</td>
                    <td className="num">{v.n}</td>
                    <td>
                      <CategorySelect
                        label={`Category for ${v.cat}`}
                        value={user ?? ""}
                        includeAuto={`Auto: ${auto}`}
                        onChange={(c) =>
                          updateRules((r) => {
                            const m = { ...r.issuerCategoryMap };
                            if (c) m[k] = c;
                            else delete m[k];
                            return { ...r, issuerCategoryMap: m };
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <PatternList
        title="Card payoffs from Schwab"
        help="Money leaving Schwab that matches one of these is a card payment and is left out of spending (the purchases already count on the card)."
        items={rules.transferPatterns}
        field="transfer"
        onChange={(fn) => set((r) => ({ transferPatterns: fn(r.transferPatterns) }))}
      />
      <PatternList
        title="Payments on cards"
        help="Credits on a card that match one of these are your payments, not refunds."
        items={rules.paymentPatterns}
        field="payment"
        onChange={(fn) => set((r) => ({ paymentPatterns: fn(r.paymentPatterns) }))}
      />

      <section className="card">
        <h2>Saved column mappings</h2>
        {rules.columnMappings.length === 0 ? (
          <p className="muted">None. These are created when you import a file from a bank that isn’t built in.</p>
        ) : (
          <ul className="rules">
            {rules.columnMappings.map((m) => (
              <li key={m.signature}>
                <strong>{m.label}</strong>
                <code>{m.signature}</code>
                <button className="link danger" onClick={() => set((r) => ({ columnMappings: r.columnMappings.filter((x) => x.signature !== m.signature) }))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
