import { expect, type APIRequestContext, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

export type DevRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "HUSTLER"
  | "MANAGER"
  | "SUPERINTENDENT"
  | "ESTIMATOR"
  | "FIELD_WORKER"
  | "VENDOR";

export interface DevLoginResponse {
  user: {
    id: string;
    email: string;
    role: string;
    organizationId: string | null;
  };
}

/**
 * Programmatic dev-login that hits `POST /api/dev/test-login` (gated by
 * ENABLE_DEV_SEED). Used by the money-path e2e specs to skip the UI
 * login step. Returns the freshly-logged-in user payload so callers
 * can capture the user.id for downstream factories.
 *
 * `linkOrg=true` forces SUPER_ADMIN sessions to also be members of the
 * Dev Sandbox Organization so org-scoped endpoints (the entire money
 * surface) don't 403 on a tenantless SUPER_ADMIN.
 */
export async function devLogin(
  page: Page,
  role: DevRole,
  opts: { linkOrg?: boolean } = {},
): Promise<DevLoginResponse> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role, linkOrg: opts.linkOrg ?? false },
  });
  expect(res.status(), `dev-login as ${role} failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as DevLoginResponse;
}

/**
 * Same as `devLogin` but keyed off an `APIRequestContext`. Used by
 * tenant-isolation specs that build a second authenticated context to
 * impersonate Org B alongside the Page-bound Org A session.
 */
export async function devLoginRequest(
  request: APIRequestContext,
  role: DevRole,
  opts: { linkOrg?: boolean } = {},
): Promise<DevLoginResponse> {
  const res = await request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role, linkOrg: opts.linkOrg ?? false },
  });
  expect(res.status(), `dev-login as ${role} failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as DevLoginResponse;
}
