// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESUMABLE_TTL_MS,
  clearAllResumableUploads,
  findResumableForFile,
  listResumableUploads,
  pruneExpired,
  removeResumableUpload,
  saveResumableUpload,
  touchResumableUpload,
  type ResumableUploadEntry,
} from "../resumableUploads";

const makeEntry = (overrides: Partial<ResumableUploadEntry> = {}): ResumableUploadEntry => ({
  uploadId: "intent-1",
  objectKey: "org/file-1",
  fileName: "video.mp4",
  fileSize: 1024 * 1024 * 1024,
  fileType: "video/mp4",
  lastModified: 1_700_000_000_000,
  bucketKind: "DOCUMENT",
  createdAt: Date.now(),
  ...overrides,
});

describe("resumableUploads", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("saves and lists resumable upload entries", () => {
    const entry = makeEntry();
    saveResumableUpload(entry);
    const all = listResumableUploads();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ uploadId: "intent-1", fileName: "video.mp4" });
  });

  it("finds an entry by file fingerprint and bucket kind", () => {
    saveResumableUpload(makeEntry({ uploadId: "a", bucketKind: "DOCUMENT" }));
    saveResumableUpload(makeEntry({ uploadId: "b", bucketKind: "MEDIA" }));

    const match = findResumableForFile("video.mp4", 1024 * 1024 * 1024, 1_700_000_000_000, "MEDIA");
    expect(match?.uploadId).toBe("b");

    const noMatch = findResumableForFile("other.mp4", 1024, 1, "DOCUMENT");
    expect(noMatch).toBeNull();
  });

  it("replaces an existing entry that matches the same file fingerprint", () => {
    saveResumableUpload(makeEntry({ uploadId: "old" }));
    saveResumableUpload(makeEntry({ uploadId: "new" }));
    const all = listResumableUploads();
    expect(all).toHaveLength(1);
    expect(all[0].uploadId).toBe("new");
  });

  it("removes an entry by uploadId", () => {
    saveResumableUpload(makeEntry({ uploadId: "a" }));
    saveResumableUpload(makeEntry({ uploadId: "b", fileName: "other.mp4" }));
    removeResumableUpload("a");
    const all = listResumableUploads();
    expect(all).toHaveLength(1);
    expect(all[0].uploadId).toBe("b");
  });

  it("prunes entries older than the TTL", () => {
    const now = 2_000_000_000_000;
    saveResumableUpload(makeEntry({ uploadId: "fresh", createdAt: now - 1000 }));
    saveResumableUpload(makeEntry({ uploadId: "stale", fileName: "x.mp4", createdAt: now - RESUMABLE_TTL_MS - 1 }));
    const remaining = pruneExpired(now);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].uploadId).toBe("fresh");
  });

  it("clearAllResumableUploads wipes storage", () => {
    saveResumableUpload(makeEntry());
    clearAllResumableUploads();
    expect(listResumableUploads()).toEqual([]);
  });

  it("touchResumableUpload refreshes createdAt for the matching entry", () => {
    const original = Date.now() - 60_000;
    saveResumableUpload(makeEntry({ uploadId: "a", createdAt: original }));
    saveResumableUpload(makeEntry({ uploadId: "b", fileName: "other.mp4", createdAt: original }));

    const refreshedAt = original + 30_000;
    touchResumableUpload("a", refreshedAt);

    const all = listResumableUploads();
    const a = all.find((e) => e.uploadId === "a");
    const b = all.find((e) => e.uploadId === "b");
    expect(a?.createdAt).toBe(refreshedAt);
    expect(b?.createdAt).toBe(original);
  });

  it("survives malformed JSON in storage", () => {
    window.localStorage.setItem("smartmanage:resumableUploads:v1", "{not json");
    expect(listResumableUploads()).toEqual([]);
    saveResumableUpload(makeEntry());
    expect(listResumableUploads()).toHaveLength(1);
  });
});
