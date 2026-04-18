import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Validate an outbound URL configured by tenants for an integration. Blocks
 * obvious SSRF vectors: non-HTTP(S) schemes, private/loopback/link-local
 * addresses, metadata services, and (after DNS resolution) hostnames that
 * resolve to private ranges.
 *
 * Throws on failure; returns the validated URL string on success.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Disallowed URL scheme: ${url.protocol}`);
  }
  // Force https in production-style hosts; allow http only for explicitly
  // permitted local/dev hosts via env (kept off by default).
  if (
    url.protocol === "http:" &&
    process.env.ALLOW_INTEGRATION_HTTP !== "true"
  ) {
    throw new Error("Only https:// URLs are allowed for external integrations");
  }

  const host = url.hostname;
  if (!host) throw new Error("URL must include a hostname");

  if (isPrivateOrReservedHost(host)) {
    throw new Error(`Disallowed host: ${host}`);
  }

  // Resolve and re-check — guards against DNS rebinding & hostnames that
  // map to RFC1918 ranges.
  if (!isIP(host)) {
    try {
      const records = await dnsLookup(host, { all: true });
      for (const rec of records) {
        if (isPrivateOrReservedIp(rec.address)) {
          throw new Error(`Host ${host} resolves to a disallowed address`);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOTFOUND") {
        throw new Error(`Host ${host} did not resolve`);
      }
      throw err;
    }
  } else if (isPrivateOrReservedIp(host)) {
    throw new Error(`Disallowed IP literal: ${host}`);
  }

  return url;
}

function isPrivateOrReservedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "metadata.google.internal") return true;
  if (lower.endsWith(".internal")) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some(isNaN)) return true;
    const [a, b] = parts;
    if (a === 10) return true;                          // 10.0.0.0/8
    if (a === 127) return true;                         // loopback
    if (a === 0) return true;                           // 0.0.0.0/8
    if (a === 169 && b === 254) return true;            // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;            // 192.168.0.0/16
    if (a === 192 && b === 0) return true;              // 192.0.0.0/24
    if (a >= 224) return true;                          // multicast/reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;                   // loopback
    if (lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true;          // link-local
    if (lower.startsWith("ff")) return true;            // multicast
    return false;
  }
  return true; // unknown family — block
}

/**
 * Convenience: validate then fetch. Always sets a 30s timeout.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const url = await validateOutboundUrl(rawUrl);
  const { timeoutMs = 30000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url.toString(), { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
