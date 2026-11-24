import { useApp } from "./state";
import { regrant } from "./storage/store";
import { fmtDate } from "./ui/format";
import { CategoryDetail } from "./ui/pages/CategoryDetail";
import { Import } from "./ui/pages/Import";
import { MerchantDetail } from "./ui/pages/MerchantDetail";
import { Overview } from "./ui/pages/Overview";
import { Rules } from "./ui/pages/Rules";
import { Settings, StorageChooser } from "./ui/pages/Settings";
import { Transactions } from "./ui/pages/Transactions";
import { href, useRoute } from "./ui/router";

const NAV = [
  { path: "/", label: "Overview" },
  { path: "/transactions", label: "Transactions" },
  { path: "/import", label: "Import" },
  { path: "/rules", label: "Rules" },
  { path: "/settings", label: "Settings" },
];

export function App() {
  const route = useRoute();
  const { ready, store, needsPermission, needsSetup, snapshot, latest, error, clearError, setStore } = useApp();
  const top = "/" + (route.segments[0] ?? "");
  const keep = new URLSearchParams(route.params);

  let body;
  if (!ready) body = <p className="muted">Loading…</p>;
  else if (needsPermission)
    body = (
      <section className="card">
        <h2>Reconnect your data folder</h2>
        <p>
          Chrome needs your OK to open <strong>{needsPermission.name}</strong> again. Choose “Allow on every visit” to skip this next time.
        </p>
        <button
          className="primary"
          onClick={async () => {
            const s = await regrant(needsPermission);
            if (s) await setStore(s);
          }}
        >
          Reconnect
        </button>
      </section>
    );
  else if (needsSetup && !store)
    body = (
      <section className="card welcome">
        <h2>Where should your spending data live?</h2>
        <p>Everything stays on this computer. The app is just a page; your transactions are never uploaded.</p>
        <ul>
          <li>
            <strong>A folder</strong> (recommended): the data sits in files you control, survives clearing the browser, and can live in a synced folder.
          </li>
          <li>
            <strong>This browser</strong>: quickest, but clearing site data erases it. Back up from Settings.
          </li>
        </ul>
        <StorageChooser />
      </section>
    );
  else if (route.segments[0] === "category") body = <CategoryDetail route={route} />;
  else if (route.segments[0] === "merchant") body = <MerchantDetail route={route} />;
  else if (top === "/transactions") body = <Transactions route={route} />;
  else if (top === "/import") body = <Import />;
  else if (top === "/rules") body = <Rules />;
  else if (top === "/settings") body = <Settings />;
  else body = <Overview route={route} />;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href={href("/", keep)}>
          Expenses
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={href(n.path, n.path === "/" || n.path === "/transactions" ? keep : undefined)} aria-current={(n.path === "/" ? top === "/" || route.segments[0] === "category" || route.segments[0] === "merchant" : top === n.path) ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="stamp">
          {snapshot.ledger.txns.length > 0 && <>Data through {fmtDate(latest)}</>}
          {store?.kind === "browser" && (
            <a className="warn" href={href("/settings")}>
              Browser storage — back up
            </a>
          )}
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}{" "}
          <button className="link" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <main>{body}</main>
    </div>
  );
}
