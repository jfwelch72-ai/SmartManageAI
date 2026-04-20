import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";

type RequestOptions = Parameters<APIRequestContext["post"]>[1];
type MutatingMethod = "post" | "patch" | "put" | "delete";

interface PatchedRequest {
  __csrfPatched?: boolean;
}

async function readCsrfCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === CSRF_COOKIE)?.value;
}

async function seedCsrfCookie(page: Page): Promise<void> {
  // Any request through the global setCsrfToken middleware will set the cookie
  // if it isn't already present. /api/auth/me is a cheap, always-mounted GET.
  await page.request.get(`${BASE_URL}/api/auth/me`).catch(() => undefined);
}

/**
 * Returns the current csrf_token cookie value, seeding it via a GET if missing.
 */
export async function getCsrfToken(page: Page): Promise<string> {
  let token = await readCsrfCookie(page);
  if (!token) {
    await seedCsrfCookie(page);
    token = await readCsrfCookie(page);
  }
  return token ?? "";
}

/**
 * Returns a header object suitable for spreading into request options.
 * Empty object when no token is available (e.g. exempt endpoints).
 */
export async function getCsrfHeader(page: Page): Promise<Record<string, string>> {
  const token = await getCsrfToken(page);
  return token ? { [CSRF_HEADER]: token } : {};
}

/**
 * Issue a mutating API request with the CSRF token attached.
 */
export async function authedRequest(
  page: Page,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  options: RequestOptions = {},
) {
  const token = await getCsrfToken(page);
  const opts: RequestOptions = {
    ...options,
    headers: { ...(options?.headers ?? {}), [CSRF_HEADER]: token },
  };
  if (method === "POST") return page.request.post(url, opts);
  if (method === "PATCH") return page.request.patch(url, opts);
  if (method === "PUT") return page.request.put(url, opts);
  return page.request.delete(url, opts);
}

/**
 * Monkey-patch a page's APIRequestContext so that every POST/PATCH/PUT/DELETE
 * automatically includes the x-csrf-token header read from the page's cookies.
 *
 * This lets existing specs continue to use page.request.post(...) etc. without
 * sprinkling CSRF plumbing across every call site. The patch is idempotent.
 */
export async function installCsrf(page: Page): Promise<void> {
  await seedCsrfCookie(page);

  const request = page.request as APIRequestContext & PatchedRequest;
  if (request.__csrfPatched) return;
  request.__csrfPatched = true;

  const wrap = (method: MutatingMethod) => {
    const original = request[method].bind(request) as (
      url: string,
      options?: RequestOptions,
    ) => Promise<ReturnType<APIRequestContext[MutatingMethod]>>;
    (request as unknown as Record<MutatingMethod, unknown>)[method] = (
      async (url: string, options: RequestOptions = {}) => {
        const token = await readCsrfCookie(page);
        const merged: RequestOptions = token
          ? {
              ...options,
              headers: { ...(options?.headers ?? {}), [CSRF_HEADER]: token },
            }
          : options;
        return original(url, merged);
      }
    );
  };

  wrap("post");
  wrap("patch");
  wrap("put");
  wrap("delete");
}

async function readCsrfFromContext(
  request: APIRequestContext,
): Promise<string | undefined> {
  const state = await request.storageState();
  return state.cookies.find((c) => c.name === CSRF_COOKIE)?.value;
}

/**
 * Variant of installCsrf that works against a raw APIRequestContext (e.g.
 * `browserContext.request`) for tests that don't use a Page. Optionally pass a
 * BrowserContext so cookies can also be read via the higher-level cookies API.
 */
export async function installCsrfOnRequest(
  request: APIRequestContext,
  browserContext?: BrowserContext,
): Promise<void> {
  await request.get(`${BASE_URL}/api/auth/me`).catch(() => undefined);

  const req = request as APIRequestContext & PatchedRequest;
  if (req.__csrfPatched) return;
  req.__csrfPatched = true;

  const wrap = (method: MutatingMethod) => {
    const original = req[method].bind(req) as (
      url: string,
      options?: RequestOptions,
    ) => Promise<ReturnType<APIRequestContext[MutatingMethod]>>;
    (req as unknown as Record<MutatingMethod, unknown>)[method] = (
      async (url: string, options: RequestOptions = {}) => {
        let token: string | undefined;
        if (browserContext) {
          const cookies = await browserContext.cookies();
          token = cookies.find((c) => c.name === CSRF_COOKIE)?.value;
        }
        if (!token) token = await readCsrfFromContext(request);
        const merged: RequestOptions = token
          ? {
              ...options,
              headers: { ...(options?.headers ?? {}), [CSRF_HEADER]: token },
            }
          : options;
        return original(url, merged);
      }
    );
  };

  wrap("post");
  wrap("patch");
  wrap("put");
  wrap("delete");
}
