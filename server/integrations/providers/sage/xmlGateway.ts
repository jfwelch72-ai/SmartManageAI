// Sage Intacct XML Gateway client (api.intacct.com/ia/xml/xmlgw.phtml).
// Builds the standard 3.0 envelope (control + authentication + content),
// posts via fetch with retry/backoff for 5xx + network errors, and parses
// the response into a typed SageResponse.

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { logError, logInfo } from "../../../utils/logger";

export const SAGE_XML_GATEWAY_URL = "https://api.intacct.com/ia/xml/xmlgw.phtml";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = [500, 1500, 4000];

// Thrown for HTTP-level failures (non-2xx, network, timeout). `retryable`
// is true for 5xx + network/abort so the sync-retry sweep can replay them.
export class SageGatewayError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly bodyExcerpt: string | undefined;
  constructor(
    message: string,
    options: { status?: number; retryable?: boolean; bodyExcerpt?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SageGatewayError";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.bodyExcerpt = options.bodyExcerpt;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export interface SageCredentials {
  /** Sage-issued sender ID (`SAGE_INTACCT_SENDER_ID`). */
  senderId: string;
  /** Sage-issued sender password (`SAGE_INTACCT_SENDER_PASSWORD`). */
  senderPassword: string;
  /** Per-tenant Web Services user ID (stored on the connection metadata). */
  userId: string;
  /** Per-tenant Web Services user password (stored on the connection metadata). */
  userPassword: string;
  /** Sage Intacct company / tenant ID (captured during the OAuth callback). */
  companyId: string;
  /** Optional location ID for multi-entity tenants. */
  locationId?: string;
}

export interface SageFunction {
  /** XML element name, e.g. "readByQuery", "create", "update", "inspect". */
  name: string;
  /** Element body — either a primitive string or a nested object the
   * XMLBuilder will serialise. Anything `undefined` is dropped. */
  body: Record<string, unknown> | string;
  /** Optional control ID per Sage spec — auto-generated if omitted. */
  controlId?: string;
}

export interface SageResponse<T = unknown> {
  /** True when the envelope authenticated successfully *and* every
   * function in the operation reported `<status>success</status>`. */
  success: boolean;
  /** Per-function payload keyed by controlId, in operation order. */
  data: T;
  /** Aggregated error messages from any failing function block. */
  errors: Array<{ controlId?: string; code?: string; message: string; description?: string }>;
  /** Raw decoded XML body (for diagnostic logging only). */
  raw?: unknown;
}

interface BuildOptions {
  uniqueId?: string;
  dtdVersion?: string;
  policyId?: string;
}

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: false,
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
});

// Build a Sage Intacct XML envelope for one or more function calls.
// Exported for unit tests; runtime callers use sageRequest.
export function buildSageEnvelope(
  credentials: SageCredentials,
  functions: SageFunction[],
  options: BuildOptions = {},
): string {
  const controlId = options.uniqueId || `smartmanage-${Date.now()}`;
  const dtdVersion = options.dtdVersion || "3.0";

  const auth: Record<string, unknown> = {
    login: {
      userid: credentials.userId,
      companyid: credentials.companyId,
      password: credentials.userPassword,
    },
  };
  if (credentials.locationId) {
    (auth.login as Record<string, unknown>).locationid = credentials.locationId;
  }

  const contentFunctions = functions.map((fn, idx) => {
    const fnControlId = fn.controlId || `${controlId}-fn${idx + 1}`;
    return {
      "@_controlid": fnControlId,
      [fn.name]: fn.body,
    };
  });

  const envelope = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    request: {
      control: {
        senderid: credentials.senderId,
        password: credentials.senderPassword,
        controlid: controlId,
        uniqueid: "false",
        dtdversion: dtdVersion,
        includewhitespace: "false",
      },
      operation: {
        authentication: auth,
        content: {
          function: contentFunctions,
        },
      },
    },
  };

  return xmlBuilder.build(envelope) as string;
}

// Parse a Sage XML Gateway response into a structured SageResponse.
// Exported for unit tests; runtime callers use sageRequest.
export function parseSageResponse<T = unknown>(xmlText: string): SageResponse<T> {
  const decoded = xmlParser.parse(xmlText);
  const root = (decoded as Record<string, any>)?.response;
  const errors: SageResponse["errors"] = [];

  if (!root) {
    return { success: false, data: {} as T, errors: [{ message: "Empty response" }], raw: decoded };
  }

  const controlStatus = root?.control?.status;
  if (controlStatus && controlStatus !== "success") {
    const ctlErrors = collectErrors(root?.control?.errormessage);
    errors.push(...ctlErrors);
  }

  const opAuthStatus = root?.operation?.authentication?.status;
  if (opAuthStatus && opAuthStatus !== "success") {
    const authErrors = collectErrors(root?.operation?.errormessage);
    errors.push(
      ...(authErrors.length ? authErrors : [{ message: "Sage authentication failed" }]),
    );
  }

  const resultNode = root?.operation?.result;
  const results = Array.isArray(resultNode) ? resultNode : resultNode ? [resultNode] : [];
  const data: Record<string, unknown> = {};
  for (const result of results) {
    const status = result?.status;
    const controlId = result?.controlid as string | undefined;
    if (status && status !== "success") {
      const fnErrors = collectErrors(result?.errormessage);
      errors.push(
        ...(fnErrors.length
          ? fnErrors.map((e) => ({ ...e, controlId }))
          : [{ controlId, message: "Sage function failed" }]),
      );
    }
    if (controlId) {
      data[controlId] = result?.data ?? result;
    }
  }

  return {
    success: errors.length === 0,
    data: data as T,
    errors,
    raw: decoded,
  };
}

function collectErrors(node: unknown): SageResponse["errors"] {
  if (!node) return [];
  const list = Array.isArray(node) ? node : [node];
  const out: SageResponse["errors"] = [];
  for (const item of list) {
    const errs = item?.error;
    const errArr = Array.isArray(errs) ? errs : errs ? [errs] : [item];
    for (const err of errArr) {
      out.push({
        code: typeof err?.errorno === "string" ? err.errorno : undefined,
        message: String(err?.description || err?.description2 || err?.errorno || "Sage error"),
        description: typeof err?.description2 === "string" ? err.description2 : undefined,
      });
    }
  }
  return out;
}

/**
 * Resolve the Sage credential bundle from env + connection metadata.
 * Throws if any required field is missing so callers fail loudly rather
 * than silently posting half-formed envelopes.
 */
export function resolveSageCredentials(metadata: Record<string, any>): SageCredentials {
  const senderId = process.env.SAGE_INTACCT_SENDER_ID || "";
  const senderPassword = process.env.SAGE_INTACCT_SENDER_PASSWORD || "";
  if (!senderId || !senderPassword) {
    throw new Error(
      "Sage Intacct sender credentials missing — set SAGE_INTACCT_SENDER_ID and SAGE_INTACCT_SENDER_PASSWORD.",
    );
  }
  const companyId = metadata?.companyId || metadata?.raw?.companyId;
  const userId = metadata?.userId || metadata?.webServicesUserId;
  const userPassword = metadata?.userPassword || metadata?.webServicesUserPassword;
  if (!companyId || !userId || !userPassword) {
    throw new Error(
      "Sage Intacct connection missing per-tenant credentials (companyId / userId / userPassword).",
    );
  }
  return {
    senderId,
    senderPassword,
    userId,
    userPassword,
    companyId,
    locationId: typeof metadata?.locationId === "string" ? metadata.locationId : undefined,
  };
}

export interface SageRequestOptions extends BuildOptions {
  /** Override fetch — used by tests + the retry-with-backoff helper below. */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Maximum total attempts including the initial call (default 3). */
  maxAttempts?: number;
  /** Backoff schedule (ms) per retry. Defaults to 500/1500/4000. */
  retryBackoffMs?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Send one or more functions to the Sage XML Gateway. 5xx + network +
// abort errors are retried with exponential backoff; 4xx fails fast.
export async function sageRequest<T = unknown>(
  credentials: SageCredentials,
  functions: SageFunction[],
  options: SageRequestOptions = {},
): Promise<SageResponse<T>> {
  const envelope = buildSageEnvelope(credentials, functions, options);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_RETRIES);
  const backoff = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

  let lastError: SageGatewayError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(SAGE_XML_GATEWAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/xml", Accept: "application/xml" },
        body: envelope,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const retryable = response.status >= 500 && response.status < 600;
        const err = new SageGatewayError(`Sage XML Gateway HTTP ${response.status}`, {
          status: response.status,
          retryable,
          bodyExcerpt: text.slice(0, 500),
        });
        logError("Sage XML Gateway HTTP error", {
          status: response.status,
          attempt,
          retryable,
          bodyExcerpt: err.bodyExcerpt,
        });
        if (!retryable || attempt >= maxAttempts) throw err;
        lastError = err;
      } else {
        const xmlText = await response.text();
        const parsed = parseSageResponse<T>(xmlText);
        if (!parsed.success) {
          logInfo("Sage XML Gateway returned error envelope", {
            errors: parsed.errors,
            functionCount: functions.length,
          });
        }
        return parsed;
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof SageGatewayError) {
        if (!err.retryable || attempt >= maxAttempts) throw err;
        lastError = err;
      } else {
        // Network errors + AbortError timeouts — treat as retryable.
        const message = err instanceof Error ? err.message : String(err);
        const wrapped = new SageGatewayError(`Sage XML Gateway network error: ${message}`, {
          retryable: true,
          cause: err,
        });
        if (attempt >= maxAttempts) throw wrapped;
        lastError = wrapped;
      }
    }
    const delay = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 1000;
    await sleep(delay);
  }
  throw lastError ?? new SageGatewayError("Sage XML Gateway: exhausted retries", { retryable: true });
}

// Typed convenience wrappers around `sageRequest` for the Sage Intacct XML
// function vocabulary. SageFunction expects `{ name, body }`, where `body`
// is either a string or a nested object that buildSageEnvelope serialises
// into the function element.

export const sageGateway = {
  inspect: <T = unknown>(
    credentials: SageCredentials,
    object: string,
    options?: SageRequestOptions,
  ) => sageRequest<T>(credentials, [{ name: "inspect", body: { object } }], options),

  read: <T = unknown>(
    credentials: SageCredentials,
    args: { object: string; keys: string | string[]; fields?: string },
    options?: SageRequestOptions,
  ) => sageRequest<T>(credentials, [{
    name: "read",
    body: {
      object: args.object,
      keys: Array.isArray(args.keys) ? args.keys.join(",") : args.keys,
      ...(args.fields ? { fields: args.fields } : {}),
      returnFormat: "xml",
    },
  }], options),

  readByQuery: <T = unknown>(
    credentials: SageCredentials,
    args: { object: string; query?: string; fields?: string; pagesize?: number },
    options?: SageRequestOptions,
  ) => sageRequest<T>(credentials, [{
    name: "readByQuery",
    body: {
      object: args.object,
      query: args.query ?? "",
      ...(args.fields ? { fields: args.fields } : {}),
      pagesize: String(args.pagesize ?? 200),
      returnFormat: "xml",
    },
  }], options),

  create: <T = unknown>(
    credentials: SageCredentials,
    body: Record<string, unknown>,
    options?: SageRequestOptions,
  ) => sageRequest<T>(credentials, [{ name: "create", body }], options),

  update: <T = unknown>(
    credentials: SageCredentials,
    body: Record<string, unknown>,
    options?: SageRequestOptions,
  ) => sageRequest<T>(credentials, [{ name: "update", body }], options),
};

