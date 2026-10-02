// Persistence. Default: IndexedDB in the browser (works from file://). Optional LAN mode:
// when the app is served by server/lan-server.mjs, all machines share one JSON database.

import type { AppSettings, Attempt, ClassGroup, Exercise, Scenario, Student } from '../core/types';

export type StoreName = 'settings' | 'classes' | 'students' | 'scenarios' | 'exercises' | 'attempts';
export const STORES: StoreName[] = ['settings', 'classes', 'students', 'scenarios', 'exercises', 'attempts'];

export interface StoreTypes {
  settings: AppSettings;
  classes: ClassGroup;
  students: Student;
  scenarios: Scenario;
  exercises: Exercise;
  attempts: Attempt;
}

interface Backend {
  kind: 'IDB' | 'LAN' | 'MEMORY';
  all(store: StoreName): Promise<unknown[]>;
  get(store: StoreName, id: string): Promise<unknown | undefined>;
  put(store: StoreName, obj: { id: string }): Promise<void>;
  del(store: StoreName, id: string): Promise<void>;
}

function idbBackend(): Promise<Backend> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open('wargamer', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = <T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
        new Promise<T>((res, rej) => {
          const t = db.transaction(store, mode);
          const r = fn(t.objectStore(store));
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      resolve({
        kind: 'IDB',
        all: (s) => tx(s, 'readonly', (st) => st.getAll()),
        get: (s, id) => tx(s, 'readonly', (st) => st.get(id)),
        put: (s, o) => tx(s, 'readwrite', (st) => st.put(o)).then(() => undefined),
        del: (s, id) => tx(s, 'readwrite', (st) => st.delete(id)).then(() => undefined),
      });
    };
  });
}

function lanBackend(base: string): Backend {
  const j = async (r: Response) => {
    if (!r.ok) throw new Error(`LAN server error ${r.status}`);
    return r.json();
  };
  return {
    kind: 'LAN',
    all: (s) => fetch(`${base}/api/${s}`).then(j),
    get: (s, id) => fetch(`${base}/api/${s}/${encodeURIComponent(id)}`).then((r) => (r.status === 404 ? undefined : j(r))),
    put: (s, o) => fetch(`${base}/api/${s}/${encodeURIComponent(o.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(j).then(() => undefined),
    del: (s, id) => fetch(`${base}/api/${s}/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(j).then(() => undefined),
  };
}

function memoryBackend(): Backend {
  const data = new Map<string, Map<string, unknown>>();
  const m = (s: string) => data.get(s) ?? data.set(s, new Map()).get(s)!;
  return {
    kind: 'MEMORY',
    all: async (s) => [...m(s).values()],
    get: async (s, id) => m(s).get(id),
    put: async (s, o) => void m(s).set(o.id, JSON.parse(JSON.stringify(o))),
    del: async (s, id) => void m(s).delete(id),
  };
}

let backend: Backend | null = null;

export async function initDb(): Promise<Backend['kind']> {
  if (backend) return backend.kind;
  if (typeof location !== 'undefined' && location.protocol.startsWith('http')) {
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      if (r.ok && (await r.json()).wargamer) {
        backend = lanBackend('');
        return backend.kind;
      }
    } catch {
      /* not served by the LAN server */
    }
  }
  try {
    backend = await idbBackend();
  } catch {
    backend = memoryBackend();
  }
  return backend.kind;
}

export function dbKind(): string {
  return backend?.kind ?? 'MEMORY';
}

function be(): Backend {
  if (!backend) backend = memoryBackend();
  return backend;
}

export const db = {
  all: <K extends StoreName>(s: K) => be().all(s) as Promise<StoreTypes[K][]>,
  get: <K extends StoreName>(s: K, id: string) => be().get(s, id) as Promise<StoreTypes[K] | undefined>,
  put: <K extends StoreName>(s: K, o: StoreTypes[K]) => be().put(s, o as { id: string }),
  del: (s: StoreName, id: string) => be().del(s, id),
};

// ------------------------------------------------------------------ export / import

export interface Bundle {
  format: 'wargamer';
  kind: 'BACKUP' | 'PACK' | 'SUBMISSION';
  version: number;
  exportedAt: number;
  note?: string;
  data: Partial<{ [K in StoreName]: StoreTypes[K][] }>;
}

export async function exportBundle(kind: Bundle['kind'], filter?: Partial<{ [K in StoreName]: (x: StoreTypes[K]) => boolean }>, note?: string): Promise<Bundle> {
  const data: Bundle['data'] = {};
  for (const s of STORES) {
    if (kind !== 'BACKUP' && s === 'settings') continue;
    const all = (await db.all(s)) as never[];
    const f = filter?.[s] as ((x: never) => boolean) | undefined;
    const rows = f ? all.filter(f) : kind === 'BACKUP' ? all : [];
    if (rows.length) (data as Record<string, unknown[]>)[s] = rows;
  }
  return { format: 'wargamer', kind, version: 1, exportedAt: Date.now(), note, data };
}

export async function importBundle(b: Bundle, opts: { overwriteSettings?: boolean } = {}): Promise<Record<string, number>> {
  if (!b || b.format !== 'wargamer') throw new Error('Not a WarGamer file.');
  const counts: Record<string, number> = {};
  for (const s of STORES) {
    const rows = (b.data as Record<string, { id: string; updatedAt?: number; completedAt?: number }[]>)[s];
    if (!rows) continue;
    if (s === 'settings' && !opts.overwriteSettings) continue;
    let n = 0;
    for (const r of rows) {
      if (s === 'attempts') {
        // keep the most advanced copy of an attempt
        const cur = (await db.get('attempts', r.id)) as Attempt | undefined;
        const rank = (a?: Attempt) => (a ? (a.status === 'COMPLETE' ? 3 : a.status === 'SUBMITTED' ? 2 : 1) : 0);
        if (cur && rank(cur) > rank(r as unknown as Attempt)) continue;
      }
      await db.put(s, r as never);
      n++;
    }
    counts[s] = n;
  }
  return counts;
}

export function downloadJson(name: string, obj: unknown): void {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  downloadBlob(name, blob);
}

export function downloadBlob(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function pickJsonFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.wgx,application/json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return reject(new Error('No file'));
      const r = new FileReader();
      r.onload = () => {
        try {
          resolve(JSON.parse(String(r.result)));
        } catch (e) {
          reject(e);
        }
      };
      r.readAsText(f);
    };
    inp.click();
  });
}

export type { ClassGroup, Exercise, Scenario, Student, Attempt, AppSettings };
