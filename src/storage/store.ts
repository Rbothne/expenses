import { del, get, set } from "idb-keyval";
import { withDefaults } from "../core/rules";
import type { Ledger, Rules } from "../core/types";

export interface Snapshot {
  ledger: Ledger;
  rules: Rules;
}

export interface Store {
  kind: "folder" | "browser";
  label: string;
  load(): Promise<Snapshot>;
  /** Apply fn to the freshest on-disk state and persist the result. Re-reads first if another device/tab wrote. */
  update(fn: (s: Snapshot) => Snapshot): Promise<Snapshot>;
  saveRaw(name: string, text: string): Promise<void>;
  /** True when files changed on disk since the last read/write. */
  changedOnDisk(): Promise<boolean>;
}

export const emptyLedger = (): Ledger => ({ version: 1, txns: [], imports: [] });

const parseSnapshot = (ledger: unknown, rules: unknown): Snapshot => {
  const l = (ledger ?? {}) as Partial<Ledger>;
  return {
    ledger: { version: 1, txns: Array.isArray(l.txns) ? l.txns : [], imports: Array.isArray(l.imports) ? l.imports : [] },
    rules: withDefaults(rules as Partial<Rules>),
  };
};

/* ---------- File System Access API typings Chrome supports but lib.dom omits ---------- */
type PermState = "granted" | "denied" | "prompt";
interface PermHandle {
  queryPermission(o: { mode: "readwrite" }): Promise<PermState>;
  requestPermission(o: { mode: "readwrite" }): Promise<PermState>;
}
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { id?: string; mode?: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const folderApiAvailable = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

const HANDLE_KEY = "expenses.dirHandle";
const MODE_KEY = "expenses.mode";

/* ---------- Folder store ---------- */
export class FolderStore implements Store {
  kind = "folder" as const;
  private seen: Record<string, number> = {};
  constructor(private dir: FileSystemDirectoryHandle) {}
  get label() {
    return this.dir.name;
  }

  private async readJson(name: string): Promise<unknown> {
    try {
      const fh = await this.dir.getFileHandle(name);
      const f = await fh.getFile();
      this.seen[name] = f.lastModified;
      const text = await f.text();
      return text.trim() ? JSON.parse(text) : undefined;
    } catch (e) {
      if ((e as DOMException).name === "NotFoundError") return undefined;
      throw e;
    }
  }

  private async writeJson(name: string, data: unknown) {
    const fh = await this.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(data, null, 1));
    await w.close();
    this.seen[name] = (await fh.getFile()).lastModified;
  }

  async load() {
    return parseSnapshot(await this.readJson("ledger.json"), await this.readJson("rules.json"));
  }

  async hasFiles() {
    for (const name of ["ledger.json", "rules.json"]) {
      try {
        await this.dir.getFileHandle(name);
        return true;
      } catch {
        /* not there */
      }
    }
    return false;
  }

  async changedOnDisk() {
    for (const name of ["ledger.json", "rules.json"]) {
      try {
        const f = await (await this.dir.getFileHandle(name)).getFile();
        if (this.seen[name] !== undefined && f.lastModified !== this.seen[name]) return true;
      } catch {
        /* missing file is not a change */
      }
    }
    return false;
  }

  async update(fn: (s: Snapshot) => Snapshot) {
    const fresh = await this.load();
    const next = fn(fresh);
    if (next.ledger !== fresh.ledger) await this.writeJson("ledger.json", next.ledger);
    if (next.rules !== fresh.rules) await this.writeJson("rules.json", next.rules);
    return next;
  }

  async saveRaw(name: string, text: string) {
    const raw = await this.dir.getDirectoryHandle("raw", { create: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fh = await raw.getFileHandle(`${stamp}_${name.replace(/[\\/:*?"<>|]/g, "_")}`, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
}

/* ---------- Browser (IndexedDB) store ---------- */
class BrowserStore implements Store {
  kind = "browser" as const;
  label = "this browser";
  async load() {
    return parseSnapshot(await get("expenses.ledger"), await get("expenses.rules"));
  }
  async changedOnDisk() {
    return false;
  }
  async update(fn: (s: Snapshot) => Snapshot) {
    const fresh = await this.load();
    const next = fn(fresh);
    if (next.ledger !== fresh.ledger) await set("expenses.ledger", next.ledger);
    if (next.rules !== fresh.rules) await set("expenses.rules", next.rules);
    return next;
  }
  async saveRaw() {
    /* raw copies are only kept in folder mode */
  }
}

export type OpenResult = { store: Store } | { needsPermission: FileSystemDirectoryHandle } | { needsSetup: true };

/** Reopen whatever storage was used last. Folder permission may need a click to re-grant. */
export async function openStore(): Promise<OpenResult> {
  const mode = await get<string>(MODE_KEY);
  if (mode === "browser") return { store: new BrowserStore() };
  const handle = await get<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (mode === "folder" && handle) {
    const state = await (handle as unknown as PermHandle).queryPermission({ mode: "readwrite" });
    if (state === "granted") return { store: new FolderStore(handle) };
    return { needsPermission: handle };
  }
  return { needsSetup: true };
}

export async function regrant(handle: FileSystemDirectoryHandle): Promise<Store | null> {
  const s = await (handle as unknown as PermHandle).requestPermission({ mode: "readwrite" });
  return s === "granted" ? new FolderStore(handle) : null;
}

/** Copy the data currently open into a newly chosen folder, but only if that folder has no data files yet. */
export async function seedFolder(target: Pick<FolderStore, "hasFiles" | "update">, current: Snapshot | null): Promise<void> {
  if (!current || (await target.hasFiles())) return;
  if (!current.ledger.txns.length && !current.ledger.imports.length) return;
  await target.update(() => current);
}

/** Ask for a data folder. An empty folder receives the data that is open right now (from whichever store). */
export async function pickFolder(current: Snapshot | null): Promise<Store> {
  const handle = await window.showDirectoryPicker!({ id: "expenses-data", mode: "readwrite" });
  const store = new FolderStore(handle);
  await seedFolder(store, current);
  await set(HANDLE_KEY, handle);
  await set(MODE_KEY, "folder");
  return store;
}

export async function chooseBrowserStorage(): Promise<Store> {
  await set(MODE_KEY, "browser");
  await del(HANDLE_KEY);
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* best effort */
  }
  return new BrowserStore();
}

export interface Backup {
  app: "expenses";
  version: 1;
  exportedAt: string;
  ledger: Ledger;
  rules: Rules;
}

export const makeBackup = (s: Snapshot): Backup => ({ app: "expenses", version: 1, exportedAt: new Date().toISOString(), ledger: s.ledger, rules: s.rules });

export function readBackup(text: string): Snapshot {
  const b = JSON.parse(text) as Partial<Backup>;
  if (b.app !== "expenses" || !b.ledger) throw new Error("Not an Expenses backup file");
  return parseSnapshot(b.ledger, b.rules);
}
