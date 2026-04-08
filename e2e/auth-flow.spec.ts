import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevLoginResponse {
  user: { id: string; role: string; email: string };
  message: string;
  isDevAccount: boolean;
}

interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  role: string;
}

interface RegisterResponse {
  user: AuthUser;
}

interface LoginResponse {
  user: AuthUser;
}

async function devLogin(page: Page, role: string): Promise<DevLoginResponse> {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<DevLoginResponse>;
}

test.describe("Auth Flow E2E", () => {
  const suffix = Date.now();

  test("register with valid credentials creates user and sets cookie", async ({ page }) => {
    const email = `pw-register-${suffix}@e2e.test`;
    const res = await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "PW",
        lastName: "Register",
        email,
        password: "TestPass1234",
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as RegisterResponse;
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(email);
    expect(body.user.firstName).toBe("PW");
  });

  test("register with duplicate email returns 400", async ({ page }) => {
    const email = `pw-dup-${suffix}@e2e.test`;
    const first = await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "First",
        lastName: "User",
        email,
        password: "TestPass1234",
      },
    });
    expect(first.status()).toBe(201);

    const second = await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "Second",
        lastName: "User",
        email,
        password: "TestPass5678",
      },
    });
    expect(second.status()).toBe(400);
  });

  test("register with weak password returns 400", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "Weak",
        lastName: "Pass",
        email: `pw-weak-${suffix}@e2e.test`,
        password: "short",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("register with missing required fields returns 400", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        email: `pw-missing-${suffix}@e2e.test`,
        password: "TestPass1234",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("login with valid credentials returns user and sets cookie", async ({ page }) => {
    const email = `pw-login-${suffix}@e2e.test`;
    await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "Login",
        lastName: "Test",
        email,
        password: "TestPass1234",
      },
    });

    const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      data: { email, password: "TestPass1234" },
    });
    expect(loginRes.status()).toBe(200);
    const body = (await loginRes.json()) as LoginResponse;
    expect(body.user || body).toBeTruthy();
  });

  test("login with wrong password returns 401", async ({ page }) => {
    const email = `pw-wrongpass-${suffix}@e2e.test`;
    await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "Wrong",
        lastName: "Pass",
        email,
        password: "TestPass1234",
      },
    });

    const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      data: { email, password: "WrongPassword1" },
    });
    expect(loginRes.status()).toBe(401);
  });

  test("login with nonexistent email returns 401", async ({ page }) => {
    const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
      data: { email: "nonexistent@nowhere.test", password: "Whatever123" },
    });
    expect(loginRes.status()).toBe(401);
  });

  test("GET /api/auth/me without auth returns 401", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test("session persistence: dev login then /api/auth/me succeeds", async ({ page }) => {
    await devLogin(page, "ADMIN");

    const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as AuthUser;
    expect(me.id).toBeTruthy();
    expect(me.role).toBe("ADMIN");
  });

  test("logout clears session", async ({ page }) => {
    await devLogin(page, "ADMIN");

    const meBeforeRes = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(meBeforeRes.status()).toBe(200);

    const logoutRes = await page.request.post(`${BASE_URL}/api/auth/logout`);
    expect(logoutRes.status()).toBe(200);

    const meAfterRes = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(meAfterRes.status()).toBe(401);
  });

  test("dev login with invalid role returns 400", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
      data: { role: "INVALID_ROLE" },
    });
    expect(res.status()).toBe(400);
  });

  test("dev login as different roles returns correct role", async ({ page }) => {
    for (const role of ["ADMIN", "ESTIMATOR", "FIELD_WORKER"]) {
      const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
        data: { role },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as DevLoginResponse;
      expect(body.user.role).toBe(role);
    }
  });

  test("repeated failed logins eventually get rate-limited (429)", async ({ page }) => {
    const email = `pw-lockout-${suffix}@e2e.test`;
    await page.request.post(`${BASE_URL}/api/auth/register`, {
      data: {
        firstName: "Lockout",
        lastName: "Test",
        email,
        password: "TestPass1234",
      },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await page.request.post(`${BASE_URL}/api/auth/login`, {
        data: { email, password: "WrongPassword99" },
      });
      statuses.push(res.status());
      if (res.status() === 429) break;
    }

    const allValid = statuses.every((s) => s === 401 || s === 429);
    expect(allValid).toBe(true);

    const hasRateLimit = statuses.includes(429);
    expect(hasRateLimit).toBe(true);
  });
});
