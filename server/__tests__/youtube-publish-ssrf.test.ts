import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1543 — Coverage for the safeDownload integration in
// `publishToYouTube` (server/social/publishService.ts). The user-supplied
// `mediaUrl` is fetched through safeDownload before being forwarded to
// the YouTube resumable-upload endpoint. These tests mirror the patterns
// in `safe-download.test.ts`: a per-test DNS allowlist (`dnsMap`) and a
// stubbed `globalThis.fetch` that routes by URL prefix so we can drive
// the (a) success, (b) blocked-private-IP and (c) oversize branches
// independently of the network and the real YouTube API.
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

import { publishToYouTube } from "../social/publishService";

const originalFetch = globalThis.fetch;

type FetchHandler = (url: string, init: any) => Response | Promise<Response>;

let fetchHandler: FetchHandler;
let fetchCalls: Array<{ url: string; init: any }> = [];

const INIT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const RESUMABLE_UPLOAD_URL = "https://upload.googleapis.com/u/abc-123";

function streamResponse(buf: Buffer, headers: Record<string, string>, status = 200) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
  return new Response(stream as any, { status, headers });
}

function makePost(mediaUrl: string) {
  return {
    id: "post-1",
    content: "hello world",
    platform: "youtube",
    mediaUrls: [mediaUrl],
    hashtags: ["test"],
    title: "Test Video",
  };
}

beforeEach(() => {
  dnsMap.clear();
  // The init + final upload URLs are on Google-controlled hosts; allow
  // them through the SSRF guard so we never have to lie about them.
  setDns("www.googleapis.com", ["142.250.80.1"]);
  setDns("upload.googleapis.com", ["142.250.80.2"]);

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

describe("Task #1543 — publishToYouTube SSRF / size guarantees", () => {
  it("performs a successful end-to-end upload when the media URL is public and within the cap", async () => {
    setDns("cdn.example.test", ["8.8.8.8"]);
    const video = Buffer.from("fake-video-bytes");

    fetchHandler = (url) => {
      if (url === INIT_URL) {
        return new Response(null, {
          status: 200,
          headers: { location: RESUMABLE_UPLOAD_URL },
        });
      }
      if (url.startsWith("https://cdn.example.test/")) {
        return streamResponse(video, {
          "content-type": "video/mp4",
          "content-length": String(video.length),
        });
      }
      if (url === RESUMABLE_UPLOAD_URL) {
        return new Response(JSON.stringify({ id: "yt-vid-123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("unexpected fetch: " + url);
    };

    const result = await publishToYouTube(
      makePost("https://cdn.example.test/movie.mp4"),
      "fake-token",
    );

    expect(result.success).toBe(true);
    expect(result.externalPostId).toBe("yt-vid-123");
    // Three fetches: init, safeDownload of the media, then upload.
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toEqual([
      INIT_URL,
      "https://cdn.example.test/movie.mp4",
      RESUMABLE_UPLOAD_URL,
    ]);
  });

  it("blocks a media URL whose hostname resolves to a private IP and never reaches the upload phase", async () => {
    // Resolves to RFC1918 → safeDownload rejects pre-fetch.
    setDns("intranet.test", ["10.0.0.5"]);

    fetchHandler = (url) => {
      if (url === INIT_URL) {
        return new Response(null, {
          status: 200,
          headers: { location: RESUMABLE_UPLOAD_URL },
        });
      }
      if (url === RESUMABLE_UPLOAD_URL) {
        throw new Error("upload must not be reached when SSRF is blocked");
      }
      throw new Error("media fetch must not be reached when SSRF is blocked: " + url);
    };

    const result = await publishToYouTube(
      makePost("https://intranet.test/secret.mp4"),
      "fake-token",
    );

    expect(result.success).toBe(false);
    expect(String(result.error || "")).toMatch(/internal network/i);

    // Only the init fetch fired; the SSRF check happens before any
    // network round-trip is made for the user-supplied media URL.
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toEqual([INIT_URL]);
  });

  it("blocks a media URL that 302-redirects to a private/metadata IP and never reaches the upload phase", async () => {
    setDns("cdn.example.test", ["8.8.8.8"]);
    setDns("metadata.test", ["169.254.169.254"]);

    fetchHandler = (url) => {
      if (url === INIT_URL) {
        return new Response(null, {
          status: 200,
          headers: { location: RESUMABLE_UPLOAD_URL },
        });
      }
      if (url.startsWith("https://cdn.example.test/")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      if (url === RESUMABLE_UPLOAD_URL) {
        throw new Error("upload must not be reached when SSRF redirect is blocked");
      }
      throw new Error("must not follow redirect into internal host: " + url);
    };

    const result = await publishToYouTube(
      makePost("https://cdn.example.test/movie.mp4"),
      "fake-token",
    );

    expect(result.success).toBe(false);
    expect(String(result.error || "")).toMatch(/unsafe destination/i);
    // Init + the initial public hop only — the post-redirect SSRF check
    // fires before the metadata host is ever contacted.
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toEqual([INIT_URL, "https://cdn.example.test/movie.mp4"]);
  });

  it("rejects an oversize media payload (advertised content-length above the 500MB cap)", async () => {
    setDns("cdn.example.test", ["8.8.8.8"]);

    fetchHandler = (url) => {
      if (url === INIT_URL) {
        return new Response(null, {
          status: 200,
          headers: { location: RESUMABLE_UPLOAD_URL },
        });
      }
      if (url.startsWith("https://cdn.example.test/")) {
        return new Response("ignored", {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            // 600MB ≫ the 500_000_000-byte cap configured at the call site.
            "content-length": "600000000",
          },
        });
      }
      if (url === RESUMABLE_UPLOAD_URL) {
        throw new Error("upload must not be reached when payload is too large");
      }
      throw new Error("unexpected fetch: " + url);
    };

    const result = await publishToYouTube(
      makePost("https://cdn.example.test/huge.mp4"),
      "fake-token",
    );

    expect(result.success).toBe(false);
    expect(String(result.error || "")).toMatch(/too large/i);
    // Init + media-fetch attempt only; upload is never reached.
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toEqual([INIT_URL, "https://cdn.example.test/huge.mp4"]);
  });
});
