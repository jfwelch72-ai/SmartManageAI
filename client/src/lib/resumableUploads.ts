const STORAGE_KEY = "smartmanage:resumableUploads:v1";
export const RESUMABLE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ResumableUploadEntry {
  uploadId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  lastModified: number;
  bucketKind: string;
  createdAt: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: StorageLike): ResumableUploadEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ResumableUploadEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ResumableUploadEntry).uploadId === "string" &&
        typeof (e as ResumableUploadEntry).objectKey === "string" &&
        typeof (e as ResumableUploadEntry).fileName === "string" &&
        typeof (e as ResumableUploadEntry).fileSize === "number" &&
        typeof (e as ResumableUploadEntry).lastModified === "number" &&
        typeof (e as ResumableUploadEntry).createdAt === "number",
    );
  } catch {
    return [];
  }
}

function writeAll(storage: StorageLike, entries: ResumableUploadEntry[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage unavailable — ignore. Resume is best-effort.
  }
}

export function pruneExpired(now: number = Date.now()): ResumableUploadEntry[] {
  const storage = getStorage();
  if (!storage) return [];
  const all = readAll(storage);
  const fresh = all.filter((e) => now - e.createdAt < RESUMABLE_TTL_MS);
  if (fresh.length !== all.length) writeAll(storage, fresh);
  return fresh;
}

export function listResumableUploads(): ResumableUploadEntry[] {
  return pruneExpired();
}

export function saveResumableUpload(entry: ResumableUploadEntry): void {
  const storage = getStorage();
  if (!storage) return;
  const fresh = pruneExpired();
  // Replace by uploadId, or by file fingerprint if a stale entry exists.
  const filtered = fresh.filter(
    (e) =>
      e.uploadId !== entry.uploadId &&
      !(
        e.fileName === entry.fileName &&
        e.fileSize === entry.fileSize &&
        e.lastModified === entry.lastModified &&
        e.bucketKind === entry.bucketKind
      ),
  );
  filtered.push(entry);
  writeAll(storage, filtered);
}

export function touchResumableUpload(uploadId: string, now: number = Date.now()): void {
  const storage = getStorage();
  if (!storage) return;
  const fresh = readAll(storage);
  let changed = false;
  const updated = fresh.map((e) => {
    if (e.uploadId === uploadId) {
      changed = true;
      return { ...e, createdAt: now };
    }
    return e;
  });
  if (changed) writeAll(storage, updated);
}

export function removeResumableUpload(uploadId: string): void {
  const storage = getStorage();
  if (!storage) return;
  const fresh = readAll(storage);
  const filtered = fresh.filter((e) => e.uploadId !== uploadId);
  if (filtered.length !== fresh.length) writeAll(storage, filtered);
}

export function findResumableForFile(
  fileName: string,
  fileSize: number,
  lastModified: number,
  bucketKind: string,
): ResumableUploadEntry | null {
  const fresh = pruneExpired();
  return (
    fresh.find(
      (e) =>
        e.fileName === fileName &&
        e.fileSize === fileSize &&
        e.lastModified === lastModified &&
        e.bucketKind === bucketKind,
    ) ?? null
  );
}

export function clearAllResumableUploads(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
