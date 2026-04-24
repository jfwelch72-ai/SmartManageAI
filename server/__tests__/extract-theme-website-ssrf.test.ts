import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1543 — Coverage for the safeDownload integration in
// `extractThemeFromWebsite` (server/aiOnboardingRoutes.ts). Mirrors the
// patterns in `safe-download.test.ts`: a per-test DNS allowlist (`dnsMap`)
// and a stubbed `globalThis.fetch` so we can drive each branch of the
// SSRF / redirect / size-cap pipeline deterministically without touching
// the network or the real AI / database stack.
//
// The function under test catches `SafeDownloadError` and returns silently
// so we assert on observable side effects instead — specifically, how many
// times the stubbed `fetch` was reached. A blocked URL must never reach
// `fetch`; a redirect-to-private URL must reach `fetch` exactly once (the
// original public host) before the post-redirect SSRF check fires; an
// oversize payload must also reach `fetch` exactly once before the byte
// cap rejects it. A successful fetch reaches `fetch` exactly once.
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

import { extractThemeFromWebsite } from "../aiOnboardingRoutes";

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

beforeEach(() => {
  dnsMap.clear();
  fetchCalls = [];
  fetchHandler = () => {
    throw new Error("fetchHandler not configured for this test");
  };
  globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    fetchCalls.push({ url, init });
    return fetchHandler(url, init);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Task #1543 — extractThemeFromWebsite SSRF / size guarantees", () => {
  it("performs a successful fetch for a public website (and short-circuits when no colors are found)", async () => {
    setDns("brand.test", ["8.8.8.8"]);
    // No colors in the body → function never reaches the AI / DB code path.
    const html = Buffer.from("<html><body>plain text only</body></html>");
    fetchHandler = () =>
      streamResponse(html, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.length),
      });

    await expect(
      extractThemeFromWebsite("org-1", "https://brand.test/", null),
    ).resolves.toBeUndefined();

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe("https://brand.test/");
  });

  it("blocks a hostname whose DNS resolves to a private IP without ever issuing a fetch", async () => {
    setDns("intranet.test", ["10.0.0.7"]);
    fetchHandler = () => {
      throw new Error("fetch should not be reached for blocked SSRF target");
    };

    await expect(
      extractThemeFromWebsite("org-1", "https://intranet.test/", null),
    ).resolves.toBeUndefined();

    expect(fetchCalls.length).toBe(0);
  });

  it("blocks a redirect that points at a private/metadata IP after the initial fetch", async () => {
    setDns("brand.test", ["8.8.8.8"]);
    setDns("metadata.test", ["169.254.169.254"]);
    fetchHandler = (url) => {
      if (url.startsWith("https://brand.test")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      throw new Error("must not follow redirect into internal host: " + url);
    };

    await expect(
      extractThemeFromWebsite("org-1", "https://brand.test/", null),
    ).resolves.toBeUndefined();

    // Exactly one fetch: the initial public hop. The redirect target
    // is rejected by the post-redirect SSRF check before any fetch is
    // issued against the internal host.
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe("https://brand.test/");
  });

  it("rejects an oversize payload (advertised content-length above the 1MB cap)", async () => {
    setDns("brand.test", ["8.8.8.8"]);
    fetchHandler = () =>
      new Response("ignored", {
        status: 200,
        headers: {
          "content-type": "text/html",
          // 2MB ≫ the 1_000_000-byte cap configured in the call site.
          "content-length": "2000000",
        },
      });

    await expect(
      extractThemeFromWebsite("org-1", "https://brand.test/", null),
    ).resolves.toBeUndefined();

    // The byte cap fires *after* the response headers come back, so we
    // expect exactly one fetch attempt that the helper aborts before
    // reading the body or invoking any downstream AI / DB work.
    expect(fetchCalls.length).toBe(1);
  });
});
