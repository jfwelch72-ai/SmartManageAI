import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1543 — Coverage for the safeDownload integration in
// `exportPlans` (server/integrations/providers/stackct/sync.ts). The
// pipeline reads a `plan_documents` row whose `fileUrl` points at an
// allow-listed cloud-storage host (e.g. `*.s3.amazonaws.com`) and pulls
// the bytes through `safeDownload` before forwarding them to STACK CT.
//
// We mock the database and the STACK CT API client so the test stays
// hermetic and a single failing fetch is observable through the
// `SyncResult.errors` array. DNS + `globalThis.fetch` are stubbed exactly
// like in `safe-download.test.ts` so the per-test allowlist drives every
// branch of the SSRF / size pipeline deterministically.
// ─────────────────────────────────────────────────────────────────────────────

const dnsMap = new Map<string, string[]>();
function setDns(host: string, ips: string[]) {
  dnsMap.set(host, ips);
}

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dns")>();
  const fakeResolve4 = (hostname: string, cb: any) => {
    const ips = dnsMap.get(hostname);
    if (ips && ips.length) return cb(null, ips);
    return cb(new Error("ENOTFOUND " + hostname));
  };
  return {
    ...actual,
    default: { ...actual, resolve4: fakeResolve4 },
    resolve4: fakeResolve4,
  };
});

// `selectQueue` lets each test enqueue the rows the next two
// `db.select(...).from(...).where(...)` chains should resolve to.
// `exportPlans` issues:
//   1. SELECT FROM plan_documents WHERE projectId = ?         → docs to export
//   2. SELECT FROM integration_sync_state WHERE ...           → existing sync (per doc)
const selectQueue: any[][] = [];
const insertedRows: Array<{ table: any; values: any }> = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (_table: any) => ({
        where: (_cond: any) => Promise.resolve(selectQueue.shift() ?? []),
      }),
    }),
    insert: (table: any) => ({
      values: async (values: any) => {
        insertedRows.push({ table, values });
      },
    }),
  },
  pool: {},
}));

// STACK CT client is replaced with spies so we can confirm that on a
// blocked / oversize fetch the file is *never* uploaded.
const listFolders = vi.fn();
const createFolder = vi.fn();
const uploadFile = vi.fn();

vi.mock("../integrations/providers/stackct/client", () => ({
  listFolders: (...args: any[]) => listFolders(...args),
  createFolder: (...args: any[]) => createFolder(...args),
  uploadFile: (...args: any[]) => uploadFile(...args),
}));

import { exportPlans } from "../integrations/providers/stackct/sync";

const originalFetch = globalThis.fetch;

type FetchHandler = (url: string, init: any) => Response | Promise<Response>;

let fetchHandler: FetchHandler;
let fetchCalls: Array<{ url: string; init: any }> = [];

function streamResponse(buf: Buffer, headers: Record<string, string>, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
  return new Response(stream as any, { status, headers });
}

function makeConnection(): any {
  return {
    id: "conn-1",
    organizationId: "org-1",
    provider: "stackct",
    status: "active",
    metadata: { accessToken: "fake-stackct-token" },
  };
}

function fakePlanDoc(fileUrl: string) {
  return {
    id: "doc-1",
    projectId: "proj-1",
    fileName: "set-A.pdf",
    fileUrl,
    mimeType: "application/pdf",
    objectKey: null, // force the URL-fetch branch instead of object-storage
  };
}

beforeEach(() => {
  dnsMap.clear();
  selectQueue.length = 0;
  insertedRows.length = 0;
  fetchCalls = [];
  fetchHandler = () => {
    throw new Error("fetchHandler not configured for this test");
  };
  globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    fetchCalls.push({ url, init });
    return fetchHandler(url, init);
  }) as any;

  listFolders.mockReset();
  createFolder.mockReset();
  uploadFile.mockReset();
  // Assume a "Plans" folder already exists so we don't have to drive
  // createFolder in every test.
  listFolders.mockResolvedValue([{ id: "folder-plans", name: "Plans" }]);
  uploadFile.mockResolvedValue({ id: "stackct-file-1" });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Task #1543 — exportPlans (STACK CT) SSRF / size guarantees", () => {
  it("performs a successful fetch from an allow-listed host and uploads the bytes to STACK CT", async () => {
    setDns("storage.googleapis.com", ["142.250.80.10"]);
    const pdf = Buffer.from("%PDF-1.4 fake-plan-bytes");

    selectQueue.push([fakePlanDoc("https://storage.googleapis.com/bucket/set-A.pdf")]);
    selectQueue.push([]); // no existing sync record → proceed

    fetchHandler = (url) => {
      if (url.startsWith("https://storage.googleapis.com/")) {
        return streamResponse(pdf, {
          "content-type": "application/pdf",
          "content-length": String(pdf.length),
        });
      }
      throw new Error("unexpected fetch: " + url);
    };

    const result = await exportPlans(makeConnection(), "stackct-proj-1", "proj-1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([]);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    // The bytes forwarded to STACK CT must be exactly what safeDownload returned.
    const uploadedBuffer: Buffer = uploadFile.mock.calls[0][4];
    expect(uploadedBuffer.equals(pdf)).toBe(true);
    expect(fetchCalls.length).toBe(1);
  });

  it("blocks an allow-listed host whose DNS resolves to a private IP and never uploads", async () => {
    // *.s3.amazonaws.com is on the host allowlist, but DNS resolves it
    // to RFC1918 — safeDownload's post-DNS check must catch this.
    setDns("evil.s3.amazonaws.com", ["10.0.0.42"]);

    selectQueue.push([fakePlanDoc("https://evil.s3.amazonaws.com/bucket/set-A.pdf")]);
    selectQueue.push([]);

    fetchHandler = () => {
      throw new Error("fetch must not be reached for blocked SSRF target");
    };

    const result = await exportPlans(makeConnection(), "stackct-proj-1", "proj-1");

    expect(result.created).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(uploadFile).not.toHaveBeenCalled();
    // SafeDownload aborts before issuing a network request when DNS
    // resolves to a private address.
    expect(fetchCalls.length).toBe(0);
  });

  it("blocks an allow-listed host that 302-redirects to a private/metadata IP and never uploads", async () => {
    setDns("storage.googleapis.com", ["142.250.80.10"]);
    setDns("metadata.test", ["169.254.169.254"]);

    selectQueue.push([fakePlanDoc("https://storage.googleapis.com/bucket/set-A.pdf")]);
    selectQueue.push([]);

    fetchHandler = (url) => {
      if (url.startsWith("https://storage.googleapis.com/")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      throw new Error("must not follow redirect into internal host: " + url);
    };

    const result = await exportPlans(makeConnection(), "stackct-proj-1", "proj-1");

    expect(result.created).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(String(result.errors[0]?.message || "")).toMatch(/unsafe destination|cannot read file content/i);
    expect(uploadFile).not.toHaveBeenCalled();
    // Exactly one fetch: the public initial hop. The metadata host is
    // never contacted because the post-redirect SSRF check fires first.
    expect(fetchCalls.length).toBe(1);
  });

  it("rejects an oversize payload (advertised content-length above the safeDownload default cap)", async () => {
    setDns("storage.googleapis.com", ["142.250.80.10"]);

    selectQueue.push([fakePlanDoc("https://storage.googleapis.com/bucket/huge.pdf")]);
    selectQueue.push([]);

    fetchHandler = (url) => {
      if (url.startsWith("https://storage.googleapis.com/")) {
        return new Response("ignored", {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            // Well above any reasonable cap — safeDownload must reject
            // up-front based on the advertised content-length.
            "content-length": String(10 * 1024 * 1024 * 1024), // 10 GB
          },
        });
      }
      throw new Error("unexpected fetch: " + url);
    };

    const result = await exportPlans(makeConnection(), "stackct-proj-1", "proj-1");

    expect(result.created).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(String(result.errors[0]?.message || "")).toMatch(/too large|cannot read file content/i);
    expect(uploadFile).not.toHaveBeenCalled();
    // One fetch attempt: safeDownload reads the headers and aborts
    // before the body is consumed or forwarded to STACK CT.
    expect(fetchCalls.length).toBe(1);
  });
});
