import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enrich, type EnrichedTxn, type GroupBy } from "./core/aggregate";
import { mergeRows } from "./core/dedup";
import type { ParseResult } from "./core/parsers";
import { defaultRules } from "./core/rules";
import type { ImportRecord, Rules } from "./core/types";
import { emptyLedger, openStore, type Snapshot, type Store } from "./storage/store";

export interface PendingImport {
  fileName: string;
  text: string;
  result: ParseResult;
}

interface AppState {
  ready: boolean;
  store: Store | null;
  needsPermission: FileSystemDirectoryHandle | null;
  needsSetup: boolean;
  snapshot: Snapshot;
  enriched: EnrichedTxn[];
  groupBy: GroupBy;
  earliest: string;
  latest: string;
  error: string | null;
  setStore(s: Store): Promise<void>;
  commitImports(items: PendingImport[]): Promise<ImportRecord[]>;
  updateRules(fn: (r: Rules) => Rules): Promise<void>;
  replaceAll(s: Snapshot): Promise<void>;
  removeImport(id: string): Promise<void>;
  clearError(): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

const today = () => new Date().toISOString().slice(0, 10);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [store, setStoreState] = useState<Store | null>(null);
  const [needsPermission, setNeedsPermission] = useState<FileSystemDirectoryHandle | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ ledger: emptyLedger(), rules: defaultRules() });
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef<Store | null>(null);

  const guard = useCallback(async <T,>(p: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await p();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }, []);

  const setStore = useCallback(
    async (s: Store) => {
      storeRef.current = s;
      setStoreState(s);
      setNeedsPermission(null);
      setNeedsSetup(false);
      const snap = await guard(() => s.load());
      if (snap) setSnapshot(snap);
    },
    [guard],
  );

  useEffect(() => {
    void (async () => {
      const r = await guard(() => openStore());
      if (r && "store" in r) await setStore(r.store);
      else if (r && "needsPermission" in r) setNeedsPermission(r.needsPermission);
      else setNeedsSetup(true);
      setReady(true);
    })();
  }, [guard, setStore]);

  // Another PC (synced folder) or tab may have written; pick it up when we regain focus.
  useEffect(() => {
    const onFocus = async () => {
      const s = storeRef.current;
      if (s && (await s.changedOnDisk().catch(() => false))) {
        const snap = await guard(() => s.load());
        if (snap) setSnapshot(snap);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [guard]);

  const update = useCallback(
    async (fn: (s: Snapshot) => Snapshot) => {
      const s = storeRef.current;
      if (!s) throw new Error("Choose where to keep your data first (Settings).");
      const next = await s.update(fn);
      setSnapshot(next);
      return next;
    },
    [],
  );

  const commitImports = useCallback(
    async (items: PendingImport[]) => {
      const records: ImportRecord[] = [];
      await guard(async () => {
        await update((snap) => {
          let txns = snap.ledger.txns;
          for (const it of items) {
            const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            const m = mergeRows(txns, it.result.rows, id);
            txns = m.txns;
            records.push({
              id,
              at: new Date().toISOString(),
              fileName: it.fileName,
              format: it.result.format!,
              account: it.result.account,
              dateFrom: it.result.dateFrom,
              dateTo: it.result.dateTo,
              rowsRead: it.result.rows.length,
              rowsAdded: m.added,
              rowsSkipped: m.skipped,
            });
          }
          return { ...snap, ledger: { ...snap.ledger, txns, imports: [...snap.ledger.imports, ...records] } };
        });
        for (const it of items) await storeRef.current?.saveRaw(it.fileName, it.text);
      });
      return records;
    },
    [guard, update],
  );

  const updateRules = useCallback(
    async (fn: (r: Rules) => Rules) => {
      await guard(() => update((snap) => ({ ...snap, rules: fn(snap.rules) })));
    },
    [guard, update],
  );

  const replaceAll = useCallback(
    async (s: Snapshot) => {
      await guard(() => update(() => s));
    },
    [guard, update],
  );

  const removeImport = useCallback(
    async (id: string) => {
      await guard(() =>
        update((snap) => ({
          ...snap,
          ledger: { ...snap.ledger, txns: snap.ledger.txns.filter((t) => t.importId !== id), imports: snap.ledger.imports.filter((i) => i.id !== id) },
        })),
      );
    },
    [guard, update],
  );

  const enriched = useMemo(() => enrich(snapshot.ledger.txns, snapshot.rules), [snapshot]);
  const [earliest, latest] = useMemo(() => {
    if (!enriched.length) return [today(), today()];
    let lo = enriched[0].date,
      hi = lo;
    for (const t of enriched) {
      if (t.date < lo) lo = t.date;
      if (t.date > hi) hi = t.date;
    }
    return [lo, hi];
  }, [enriched]);

  const value: AppState = {
    ready,
    store,
    needsPermission,
    needsSetup,
    snapshot,
    enriched,
    groupBy: snapshot.rules.breakdownBy,
    earliest,
    latest,
    error,
    setStore,
    commitImports,
    updateRules,
    replaceAll,
    removeImport,
    clearError: () => setError(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
