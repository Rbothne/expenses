import { useMemo, useRef, useState } from "react";
import { defaultRules } from "../../core/rules";
import { useApp } from "../../state";
import { chooseBrowserStorage, emptyLedger, folderApiAvailable, makeBackup, pickFolder, readBackup } from "../../storage/store";
import { bankLabel, cardLabel } from "../format";

export function StorageChooser() {
  const { setStore } = useApp();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="row wrap">
      {folderApiAvailable() ? (
        <button
          className="primary"
          onClick={async () => {
            try {
              await setStore(await pickFolder());
            } catch (e) {
              if ((e as DOMException).name !== "AbortError") setErr(String(e));
            }
          }}
        >
          Choose a data folder
        </button>
      ) : (
        <span className="note">This browser can’t use a folder on disk; Chrome or Edge on a computer can.</span>
      )}
      <button onClick={async () => setStore(await chooseBrowserStorage())}>Keep data in this browser</button>
      {err && <span className="danger">{err}</span>}
    </div>
  );
}

export function Settings() {
  const { store, snapshot, updateRules, replaceAll, enriched } = useApp();
  const rules = snapshot.rules;
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const cards = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of enriched) m.set(`${t.account}:${t.cardKey}`, (m.get(`${t.account}:${t.cardKey}`) ?? 0) + 1);
    return [...m.entries()].sort();
  }, [enriched]);

  const download = () => {
    const blob = new Blob([JSON.stringify(makeBackup(snapshot))], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `expenses-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <section className="card">
        <h2>Where your data lives</h2>
        {store ? (
          <p>
            {store.kind === "folder" ? (
              <>
                Folder <strong>{store.label}</strong> on this computer: <code>ledger.json</code>, <code>rules.json</code>, and original files in <code>raw/</code>.
              </>
            ) : (
              <>
                <strong>This browser only.</strong> Clearing site data erases it. Download a backup regularly, or switch to a folder.
              </>
            )}
          </p>
        ) : (
          <p>Not set up yet.</p>
        )}
        <StorageChooser />
        <p className="note">Switching to a new, empty folder copies what’s in this browser into it. Nothing is ever sent to a server.</p>
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="note">One JSON file with every transaction and rule. Use it to move to another device (including viewing on a phone).</p>
        <div className="row">
          <button onClick={download} disabled={!snapshot.ledger.txns.length}>
            Download backup
          </button>
          <button onClick={() => file.current?.click()}>Restore from backup…</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const s = readBackup(await f.text());
                if (!confirm(`Replace current data with ${s.ledger.txns.length.toLocaleString()} transactions from ${f.name}?`)) return;
                await replaceAll(s);
                setMsg("Restored.");
              } catch (err) {
                setMsg(err instanceof Error ? err.message : String(err));
              }
              e.target.value = "";
            }}
          />
        </div>
        {msg && <p className="note">{msg}</p>}
      </section>

      <section className="card">
        <h2>Cards</h2>
        <label className="field">
          <span>Break spending down by</span>
          <select value={rules.breakdownBy} onChange={(e) => {
            const v = e.target.value as "bank" | "card";
            void updateRules((r) => ({ ...r, breakdownBy: v }));
          }}>
            <option value="bank">Bank (all cards at a bank together)</option>
            <option value="card">Individual card</option>
          </select>
        </label>
        {cards.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bank</th>
                <th>Card</th>
                <th className="num">Txns</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {cards.map(([id, n]) => {
                const [acct, ...rest] = id.split(":");
                return (
                  <tr key={id}>
                    <td>{bankLabel(acct, rules)}</td>
                    <td>
                      <code>{rest.join(":")}</code>
                    </td>
                    <td className="num">{n}</td>
                    <td>
                      <input
                        defaultValue={rules.cardNames[id] ?? ""}
                        placeholder={cardLabel(id, { ...rules, cardNames: {} })}
                        aria-label={`Name for ${id}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === (rules.cardNames[id] ?? "")) return;
                          void updateRules((r) => {
                            const c = { ...r.cardNames };
                            if (v) c[id] = v;
                            else delete c[id];
                            return { ...r, cardNames: c };
                          });
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Start over</h2>
        <div className="row">
          <button
            className="danger"
            disabled={!store}
            onClick={async () => {
              if (!confirm("Delete all transactions and rules? Download a backup first if unsure.")) return;
              await replaceAll({ ledger: emptyLedger(), rules: defaultRules() });
            }}
          >
            Erase everything
          </button>
          <button
            disabled={!store}
            onClick={async () => {
              if (!confirm("Delete all transactions but keep your categories and rules?")) return;
              await replaceAll({ ledger: emptyLedger(), rules });
            }}
          >
            Erase transactions only
          </button>
        </div>
      </section>
    </>
  );
}
