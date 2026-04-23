import dns from "dns";
import { promisify } from "util";

const dnsResolve4 = promisify(dns.resolve4);

export const DEFAULT_ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "text/plain",
  "text/csv",
];

export const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_REDIRECTS = 5;

export function isPrivateHostname(hn: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|\[::1\]|169\.254\.)/.test(hn)
    || hn === "localhost"
    || hn.endsWith(".local")
    || hn.endsWith(".internal");
}

export function isPrivateIp(ip: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/.test(ip);
}

export async function validateSafeUrl(targetUrl: URL): Promise<string | null> {
  if (targetUrl.protocol !== "https:") {
    return "Only HTTPS URLs are allowed for security.";
  }
  if (isPrivateHostname(targetUrl.hostname)) {
    return "This URL points to an internal network address and can't be accessed.";
  }
  try {
    const ips = await dnsResolve4(targetUrl.hostname);
    if (ips.some((ip: string) => isPrivateIp(ip))) {
      return "This URL points to an internal network address and can't be accessed.";
    }
  } catch {
    return "Could not resolve the hostname.";
  }
  return null;
}

export interface SafeDownloadOptions {
  url: string;
  headers?: Record<string, string>;
  method?: string;
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
  allowedContentTypes?: string[] | null;
}

export interface SafeDownloadResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

export class SafeDownloadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetches a URL with manual redirect handling. Every hop (including the
 * initial URL) is re-validated against the SSRF allowlist (HTTPS only,
 * non-private hostname/IP). Optionally enforces a content-type allowlist
 * and a maximum byte length, re-checked after the body has been read.
 */
export async function safeDownload(opts: SafeDownloadOptions): Promise<SafeDownloadResult> {
  const {
    url,
    headers = {},
    method = "GET",
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    maxBytes = MAX_DOWNLOAD_SIZE,
    allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
  } = opts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafeDownloadError("Invalid URL");
  }
  const initial = await validateSafeUrl(parsed);
  if (initial) throw new SafeDownloadError(initial);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = parsed.toString();
    let currentHeaders: Record<string, string> = { ...headers };
    let currentMethod = method;
    let redirectCount = 0;
    let response: Response;
    let currentOrigin = parsed.origin;

    while (true) {
      response = await fetch(currentUrl, {
        method: currentMethod,
        headers: currentHeaders,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new SafeDownloadError("Too many redirects.");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new SafeDownloadError("Redirect without a destination.");
        }
        let next: URL;
        try {
          next = new URL(location, currentUrl);
        } catch {
          throw new SafeDownloadError("Redirect to invalid URL.");
        }
        const v = await validateSafeUrl(next);
        if (v) {
          throw new SafeDownloadError("Redirected to an unsafe destination and was blocked for security.");
        }
        // Drain the body of the redirect response to free the socket.
        try { await response.arrayBuffer(); } catch { /* noop */ }
        // Strip Authorization-like headers when crossing origins so we
        // don't leak provider bearer tokens to a third-party host.
        if (next.origin !== currentOrigin) {
          const stripped: Record<string, string> = {};
          for (const [k, v] of Object.entries(currentHeaders)) {
            const lk = k.toLowerCase();
            if (lk === "authorization" || lk === "cookie" || lk === "dropbox-api-arg") continue;
            stripped[k] = v;
          }
          currentHeaders = stripped;
        }
        // Per RFC 7231, 303 (and historically 301/302) on a non-GET should
        // become GET on the redirect target.
        if (response.status === 303 || response.status === 301 || response.status === 302) {
          if (currentMethod !== "GET" && currentMethod !== "HEAD") {
            currentMethod = "GET";
          }
        }
        currentUrl = next.toString();
        currentOrigin = next.origin;
        continue;
      }
      break;
    }

    if (!response.ok) {
      throw new SafeDownloadError(`Download failed (HTTP ${response.status}).`, 502);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    if (allowedContentTypes && !allowedContentTypes.includes(contentType)) {
      throw new SafeDownloadError("This file type isn't supported.");
    }

    const contentLengthHdr = response.headers.get("content-length");
    if (contentLengthHdr) {
      const advertised = parseInt(contentLengthHdr, 10);
      if (Number.isFinite(advertised) && advertised > maxBytes) {
        throw new SafeDownloadError("File is too large (over the allowed limit).");
      }
    }

    // Stream the body so we can enforce the size cap even when the
    // server lied about (or omitted) content-length.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            try { await reader.cancel(); } catch { /* noop */ }
            throw new SafeDownloadError("File is too large (over the allowed limit).");
          }
          chunks.push(value);
        }
      }
    } else {
      const ab = await response.arrayBuffer();
      total = ab.byteLength;
      if (total > maxBytes) {
        throw new SafeDownloadError("File is too large (over the allowed limit).");
      }
      chunks.push(new Uint8Array(ab));
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), total);
    if (buffer.length > maxBytes) {
      throw new SafeDownloadError("File is too large (over the allowed limit).");
    }

    return { buffer, contentType, finalUrl: currentUrl };
  } catch (err: any) {
    if (err instanceof SafeDownloadError) throw err;
    if (err?.name === "AbortError") {
      throw new SafeDownloadError("The download took too long.", 408);
    }
    throw new SafeDownloadError("Failed to download the file.", 502);
  } finally {
    clearTimeout(timer);
  }
}
