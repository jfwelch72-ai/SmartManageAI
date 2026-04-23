import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1456 — Unit tests for `server/services/safeDownload.ts`. These lock
// in the SSRF + size + content-type guarantees the helper is supposed to
// provide so that future changes can't silently regress them. The test
// double for `dns.resolve4` is a per-test allowlist (`dnsMap`) and the
// network is replaced with a per-test `fetchHandler` so we can exercise
// every branch of the redirect/validation pipeline deterministically.
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

import {
  safeDownload,
  SafeDownloadError,
  validateSafeUrl,
  isPrivateHostname,
  isPrivateIp,
} from "../services/safeDownload";

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

describe("isPrivateHostname / isPrivateIp", () => {
  it("flags well-known private hostnames", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("foo.local")).toBe(true);
    expect(isPrivateHostname("svc.internal")).toBe(true);
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("169.254.169.254")).toBe(true);
    expect(isPrivateHostname("example.com")).toBe(false);
  });

  it("flags RFC1918 / loopback / link-local IPv4 addresses", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.0.5")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
  });
});

describe("validateSafeUrl", () => {
  it("rejects non-HTTPS URLs", async () => {
    setDns("example.test", ["1.2.3.4"]);
    expect(await validateSafeUrl(new URL("http://example.test/x"))).toMatch(/HTTPS/);
  });

  it("rejects private hostnames before DNS", async () => {
    expect(await validateSafeUrl(new URL("https://localhost/x"))).toMatch(/internal network/);
  });

  it("rejects hostnames whose DNS resolves to a private IP", async () => {
    setDns("internal.test", ["10.0.0.5"]);
    expect(await validateSafeUrl(new URL("https://internal.test/x"))).toMatch(/internal network/);
  });

  it("rejects hostnames that fail DNS resolution", async () => {
    expect(await validateSafeUrl(new URL("https://does-not-resolve.test/x"))).toMatch(/resolve/);
  });

  it("returns null for safe URLs", async () => {
    setDns("good.test", ["8.8.8.8"]);
    expect(await validateSafeUrl(new URL("https://good.test/x"))).toBeNull();
  });
});

describe("safeDownload — protocol + initial SSRF guard", () => {
  it("rejects http:// URLs with an HTTPS-only error", async () => {
    await expect(
      safeDownload({ url: "http://example.test/x.pdf" }),
    ).rejects.toThrow(/HTTPS/);
  });

  it("rejects URLs whose hostname is private (e.g. localhost)", async () => {
    await expect(
      safeDownload({ url: "https://localhost/x.pdf" }),
    ).rejects.toThrow(/internal network/);
  });

  it("rejects URLs whose DNS resolves to a private IP", async () => {
    setDns("internal-only.test", ["10.0.0.5"]);
    await expect(
      safeDownload({ url: "https://internal-only.test/x.pdf" }),
    ).rejects.toThrow(/internal network/);
  });

  it("throws SafeDownloadError instances with status defaulting to 400", async () => {
    try {
      await safeDownload({ url: "http://example.test/x.pdf" });
      throw new Error("expected throw");
    } catch (err: any) {
      expect(err).toBeInstanceOf(SafeDownloadError);
      expect(err.status).toBe(400);
    }
  });
});

describe("safeDownload — redirects", () => {
  it("blocks a redirect that points at an internal IP (post-redirect SSRF)", async () => {
    setDns("public.test", ["93.184.216.34"]);
    setDns("metadata.test", ["169.254.169.254"]);
    fetchHandler = (url) => {
      if (url.startsWith("https://public.test")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      throw new Error("should not reach internal host: " + url);
    };

    await expect(
      safeDownload({ url: "https://public.test/start" }),
    ).rejects.toThrow(/unsafe destination/);
  });

  it("enforces the maxRedirects cap", async () => {
    setDns("hop.test", ["1.2.3.4"]);
    fetchHandler = (url) => {
      // Always redirect again to exhaust the cap.
      return new Response(null, {
        status: 302,
        headers: { location: "https://hop.test/next?_=" + Math.random() },
      });
    };

    await expect(
      safeDownload({ url: "https://hop.test/start", maxRedirects: 2 }),
    ).rejects.toThrow(/Too many redirects/);
    // 1 initial + 2 allowed redirects = 3 fetches; the 3rd 3xx response
    // tips the counter past `maxRedirects` and aborts before fetch #4.
    expect(fetchCalls.length).toBe(3);
  });

  it("strips Authorization/Cookie/Dropbox-API-Arg on cross-origin redirects", async () => {
    setDns("origin1.test", ["1.2.3.4"]);
    setDns("origin2.test", ["5.6.7.8"]);
    fetchHandler = (url) => {
      if (url.startsWith("https://origin1.test")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://origin2.test/file.txt" },
        });
      }
      if (url.startsWith("https://origin2.test")) {
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": "2" },
        });
      }
      throw new Error("unexpected " + url);
    };

    const result = await safeDownload({
      url: "https://origin1.test/file.txt",
      headers: {
        Authorization: "Bearer super-secret",
        Cookie: "sid=abc",
        "Dropbox-API-Arg": '{"path":"/x"}',
        "X-Keep-Me": "yes",
      },
      allowedContentTypes: ["text/plain"],
    });

    expect(result.buffer.toString()).toBe("ok");
    expect(result.finalUrl).toBe("https://origin2.test/file.txt");

    const second = fetchCalls[1];
    const headers = (second.init?.headers ?? {}) as Record<string, string>;
    // Sensitive headers must be gone after a cross-origin hop.
    expect(headers.Authorization).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(headers["Dropbox-API-Arg"]).toBeUndefined();
    // Non-sensitive headers should pass through.
    expect(headers["X-Keep-Me"]).toBe("yes");
  });

  it("preserves Authorization on same-origin redirects", async () => {
    setDns("origin1.test", ["1.2.3.4"]);
    fetchHandler = (url) => {
      if (url === "https://origin1.test/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://origin1.test/next" },
        });
      }
      if (url === "https://origin1.test/next") {
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": "2" },
        });
      }
      throw new Error("unexpected " + url);
    };

    await safeDownload({
      url: "https://origin1.test/start",
      headers: { Authorization: "Bearer keep-me" },
      allowedContentTypes: ["text/plain"],
    });

    const second = fetchCalls[1];
    expect((second.init?.headers as any).Authorization).toBe("Bearer keep-me");
  });
});

describe("safeDownload — content-type allowlist", () => {
  it("rejects responses whose content-type isn't on the allowlist", async () => {
    setDns("public.test", ["1.2.3.4"]);
    fetchHandler = () =>
      new Response("<html>nope</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    await expect(
      safeDownload({
        url: "https://public.test/file",
        allowedContentTypes: ["application/pdf"],
      }),
    ).rejects.toThrow(/file type isn't supported/);
  });

  it("accepts responses whose content-type IS on the allowlist", async () => {
    setDns("public.test", ["1.2.3.4"]);
    const body = Buffer.from("%PDF-1.4 hello");
    fetchHandler = () =>
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/pdf; charset=binary",
          "content-length": String(body.length),
        },
      });

    const r = await safeDownload({
      url: "https://public.test/file",
      allowedContentTypes: ["application/pdf"],
    });
    expect(r.contentType).toBe("application/pdf");
    expect(r.buffer.equals(body)).toBe(true);
  });

  it("skips the allowlist when allowedContentTypes is null", async () => {
    setDns("public.test", ["1.2.3.4"]);
    fetchHandler = () =>
      new Response("anything", {
        status: 200,
        headers: { "content-type": "application/x-weird", "content-length": "8" },
      });
    const r = await safeDownload({
      url: "https://public.test/file",
      allowedContentTypes: null,
    });
    expect(r.contentType).toBe("application/x-weird");
  });
});

describe("safeDownload — byte cap", () => {
  it("rejects upfront when the advertised content-length exceeds maxBytes", async () => {
    setDns("public.test", ["1.2.3.4"]);
    fetchHandler = () =>
      new Response("ignored", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": "9999999",
        },
      });
    await expect(
      safeDownload({ url: "https://public.test/x", maxBytes: 1024 }),
    ).rejects.toThrow(/too large/);
  });

  it("enforces the cap on the streamed body when content-length is missing", async () => {
    setDns("public.test", ["1.2.3.4"]);
    const big = Buffer.alloc(2048, 0x41);
    fetchHandler = () =>
      streamResponse(big, { "content-type": "application/pdf" });
    await expect(
      safeDownload({ url: "https://public.test/x", maxBytes: 1024 }),
    ).rejects.toThrow(/too large/);
  });

  it("enforces the cap on the streamed body when content-length lies", async () => {
    setDns("public.test", ["1.2.3.4"]);
    const big = Buffer.alloc(2048, 0x41);
    fetchHandler = () =>
      streamResponse(big, {
        "content-type": "application/pdf",
        // Lie: claim well under the cap, then actually stream 2KB.
        "content-length": "100",
      });
    await expect(
      safeDownload({ url: "https://public.test/x", maxBytes: 1024 }),
    ).rejects.toThrow(/too large/);
  });

  it("returns the body when it fits under the cap", async () => {
    setDns("public.test", ["1.2.3.4"]);
    const small = Buffer.from("hi there");
    fetchHandler = () =>
      streamResponse(small, { "content-type": "application/pdf" });
    const r = await safeDownload({
      url: "https://public.test/x",
      maxBytes: 1024,
    });
    expect(r.buffer.equals(small)).toBe(true);
  });
});
