import AsyncStorage from "@react-native-async-storage/async-storage";

export type Source = "camera" | "gallery" | "generated";

export type HistoryItem = {
  id: string;
  value: string;
  format: string;
  source: Source;
  createdAt: number;
  saved: boolean;
};

const KEY = "qr_history"; // same key as before, so old saved items migrate
const MAX_ITEMS = 500;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const group = (s: Source) => (s === "generated" ? "created" : "scanned");

// Serialise storage access so quick back-to-back calls can't overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function run<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

async function read(): Promise<HistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: any[] = raw ? JSON.parse(raw) : [];
    let migrated = false;
    const items: HistoryItem[] = list
      .filter((i) => i && typeof i.value === "string")
      .map((i, n) => {
        if (!i.id) migrated = true;
        return {
          id: i.id ?? `legacy-${i.scannedAt ?? i.createdAt ?? 0}-${n}`,
          value: i.value,
          format: i.format ?? "QR Code",
          source: (i.source ?? "camera") as Source,
          createdAt: i.createdAt ?? i.scannedAt ?? Date.now(),
          saved: i.saved ?? true, // the old list only held items the user saved
        };
      });
    if (migrated) await write(items);
    return items;
  } catch {
    return [];
  }
}

async function write(list: HistoryItem[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
}

export const loadHistory = () => run(read);

/** Log a scan or a generated code. Re-scanning the same value moves it to the top. */
export const addToHistory = (e: {
  value: string;
  format: string;
  source: Source;
}) =>
  run(async () => {
    const list = await read();
    const prev = list.find(
      (i) => i.value === e.value && group(i.source) === group(e.source),
    );
    const item: HistoryItem = {
      id: newId(),
      value: e.value,
      format: e.format,
      source: e.source,
      createdAt: Date.now(),
      saved: prev?.saved ?? false,
    };
    await write([item, ...list.filter((i) => i !== prev)]);
    return item;
  });

export const toggleSaved = (id: string) =>
  run(async () => {
    const list = await read();
    const idx = list.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const updated = { ...list[idx], saved: !list[idx].saved };
    list[idx] = updated;
    await write(list);
    return updated;
  });

export const removeItem = (id: string) =>
  run(async () => {
    const list = await read();
    await write(list.filter((i) => i.id !== id));
  });
