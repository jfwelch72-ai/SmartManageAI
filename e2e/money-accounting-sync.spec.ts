/**
 * Money path: Accounting integration sync (QuickBooks Online + Sage
 * Intacct sandboxes).
 *
 * Task #2506 — Wires the round-trip coverage that #2483 deferred. The
 * QBO and Sage Intacct provider modules now live under
 * `server/integrations/providers/{qbo,sage}` and the unified sync
 * dispatcher is at `POST /api/integrations/connections/:id/sync`. Each
 * test below:
 *
 *   1. Skips when its sandbox credentials aren't wired into the env
 *      (so dev / CI without secrets stays green and noise-free).
 *   2. Seeds an `integration_connections` row pre-encrypted with the
 *      sandbox creds via the dev-only
 *      `POST /api/dev/integration-connection` route (gated by
 *      ENABLE_DEV_SEED).
 *   3. POSTs an invoice through the unified sync route.
 *   4. Polls the sandbox directly (QBO REST or Sage XML Gateway) for
 *      the just-created record and asserts the round-trip on totals,
 *      customer, and line item count so a regression in either
 *      provider's serializer is caught.
 *
 * Required secrets (see `.env.example`):
 *   QBO_SANDBOX_CLIENT_ID, QBO_SANDBOX_CLIENT_SECRET,
 *   QBO_SANDBOX_REFRESH_TOKEN, QBO_SANDBOX_REALM_ID
 *
 *   SAGE_INTACCT_SANDBOX_COMPANY_ID, SAGE_INTACCT_SANDBOX_USER_ID,
 *   SAGE_INTACCT_SANDBOX_USER_PASSWORD,
 *   SAGE_INTACCT_SANDBOX_SENDER_ID, SAGE_INTACCT_SANDBOX_SENDER_PASSWORD
 */
import { test, expect } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const QBO_REQUIRED = [
  "QBO_SANDBOX_CLIENT_ID",
  "QBO_SANDBOX_CLIENT_SECRET",
  "QBO_SANDBOX_REFRESH_TOKEN",
  "QBO_SANDBOX_REALM_ID",
] as const;
const SAGE_REQUIRED = [
  "SAGE_INTACCT_SANDBOX_SENDER_ID",
  "SAGE_INTACCT_SANDBOX_SENDER_PASSWORD",
  "SAGE_INTACCT_SANDBOX_COMPANY_ID",
  "SAGE_INTACCT_SANDBOX_USER_ID",
  "SAGE_INTACCT_SANDBOX_USER_PASSWORD",
] as const;

const hasQboCreds = QBO_REQUIRED.every((k) => !!process.env[k]);
const hasSageCreds = SAGE_REQUIRED.every((k) => !!process.env[k]);

const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SAGE_GATEWAY_URL = "https://api.intacct.com/ia/xml/xmlgw.phtml";

interface QboTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function refreshQboAccessToken(): Promise<QboTokenResponse> {
  const basicAuth = Buffer.from(
    `${process.env.QBO_SANDBOX_CLIENT_ID}:${process.env.QBO_SANDBOX_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.QBO_SANDBOX_REFRESH_TOKEN!,
    }),
  });
  if (!res.ok) {
    throw new Error(`QBO sandbox token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as QboTokenResponse;
}

async function qboSandboxFetch(accessToken: string, endpoint: string): Promise<any> {
  const realmId = process.env.QBO_SANDBOX_REALM_ID;
  const res = await fetch(`${QBO_SANDBOX_BASE}/v3/company/${realmId}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`QBO sandbox fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function buildSageEnvelope(body: string): string {
  const senderId = process.env.SAGE_INTACCT_SANDBOX_SENDER_ID;
  const senderPw = process.env.SAGE_INTACCT_SANDBOX_SENDER_PASSWORD;
  const userId = process.env.SAGE_INTACCT_SANDBOX_USER_ID;
  const userPw = process.env.SAGE_INTACCT_SANDBOX_USER_PASSWORD;
  const companyId = process.env.SAGE_INTACCT_SANDBOX_COMPANY_ID;
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${senderId}</senderid>
    <password>${senderPw}</password>
    <controlid>e2e-${Date.now()}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <login>
        <userid>${userId}</userid>
        <companyid>${companyId}</companyid>
        <password>${userPw}</password>
      </login>
    </authentication>
    <content>${body}</content>
  </operation>
</request>`;
}

async function sageSandboxReadByQuery(args: {
  object: string;
  query: string;
  fields: string;
}): Promise<any> {
  const body = `<function controlid="e2e-readbyquery">
      <readByQuery>
        <object>${args.object}</object>
        <fields>${args.fields}</fields>
        <query>${args.query}</query>
        <pagesize>50</pagesize>
      </readByQuery>
    </function>`;
  const res = await fetch(SAGE_GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/xml", Accept: "application/xml" },
    body: buildSageEnvelope(body),
  });
  if (!res.ok) {
    throw new Error(`Sage gateway fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.text();
}

test.describe("Accounting sandbox sync (QBO + Sage Intacct)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN", { linkOrg: true });
  });

  test("invoice round-trips against the QBO sandbox", async ({ page }) => {
    test.skip(
      !hasQboCreds,
      `Skipped — set ${QBO_REQUIRED.join(", ")} to exercise the QBO sandbox round-trip.`,
    );
    test.skip(
      process.env.QBO_ENVIRONMENT === "production",
      "Refusing to run the e2e accounting-sync spec with QBO_ENVIRONMENT=production.",
    );
    // QBO refresh tokens are valid for 100 days; this also exercises
    // the same OAuth path the production refreshToken handler uses.
    const tokens = await refreshQboAccessToken();

    const seedRes = await page.request.post(`${BASE_URL}/api/dev/integration-connection`, {
      data: {
        provider: "qbo",
        displayName: "QBO sandbox (e2e)",
        metadata: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          scope: "com.intuit.quickbooks.accounting",
          tokenType: "Bearer",
          raw: { realmId: process.env.QBO_SANDBOX_REALM_ID },
        },
      },
    });
    expect(seedRes.status(), `seed-connection failed: ${await seedRes.text()}`).toBe(201);
    const { id: connectionId } = (await seedRes.json()) as { id: string };

    const localInvoiceId = `e2e-qbo-${Date.now()}`;
    const docNumber = `E2E-${Date.now().toString().slice(-8)}`;
    const customerRef = process.env.QBO_SANDBOX_CUSTOMER_ID || "1";
    const amount = 432.1;

    const syncRes = await page.request.post(
      `${BASE_URL}/api/integrations/connections/${connectionId}/sync`,
      {
        data: {
          operation: "invoices",
          dryRun: false,
          data: {
            invoice: {
              localInvoiceId,
              customerRef,
              docNumber,
              lineItems: [
                { description: "SmartManage e2e round-trip", amount },
              ],
            },
          },
        },
      },
    );
    expect(syncRes.status(), `sync failed: ${await syncRes.text()}`).toBe(200);
    const syncJson = await syncRes.json();
    expect(syncJson.success ?? syncJson?.result?.success).toBeTruthy();

    // Poll QBO for the invoice — it should be visible immediately, but
    // give the API up to 10s to settle in case sandbox is slow.
    const query = encodeURIComponent(
      `SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`,
    );
    let qboInvoice: any | undefined;
    const deadline = Date.now() + 10_000;
    while (!qboInvoice && Date.now() < deadline) {
      const data = await qboSandboxFetch(tokens.access_token, `query?query=${query}`);
      const matches = data?.QueryResponse?.Invoice;
      if (matches && matches.length > 0) {
        qboInvoice = matches[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(qboInvoice, `Invoice ${docNumber} not found in QBO sandbox`).toBeTruthy();
    expect(Number(qboInvoice.TotalAmt)).toBeCloseTo(amount, 2);
    expect(qboInvoice.CustomerRef?.value).toBe(customerRef);
    expect(Array.isArray(qboInvoice.Line)).toBe(true);
    const salesLines = qboInvoice.Line.filter(
      (l: any) => l.DetailType === "SalesItemLineDetail",
    );
    expect(salesLines.length).toBe(1);
    expect(Number(salesLines[0].Amount)).toBeCloseTo(amount, 2);
    expect(salesLines[0].Description).toContain("e2e round-trip");
  });

  test("invoice round-trips against the Sage Intacct sandbox", async ({ page }) => {
    test.skip(
      !hasSageCreds,
      `Skipped — set ${SAGE_REQUIRED.join(", ")} to exercise the Sage Intacct sandbox round-trip.`,
    );

    // The unified dispatcher refuses Sage operations unless this flag
    // is on. Flip it in-process for the duration of the test run when
    // sandbox creds are present so contributors don't have to remember
    // a second toggle.
    if (process.env.INTEGRATION_SAGE !== "true") {
      process.env.INTEGRATION_SAGE = "true";
    }

    const seedRes = await page.request.post(`${BASE_URL}/api/dev/integration-connection`, {
      data: {
        provider: "sage_intacct",
        displayName: "Sage Intacct sandbox (e2e)",
        metadata: {
          accessToken: "sage-sandbox-noop-token",
          scope: "job_cost ap ar",
          tokenType: "Bearer",
          raw: {
            companyId: process.env.SAGE_INTACCT_SANDBOX_COMPANY_ID,
            userId: process.env.SAGE_INTACCT_SANDBOX_USER_ID,
            userPassword: process.env.SAGE_INTACCT_SANDBOX_USER_PASSWORD,
          },
        },
      },
    });
    expect(seedRes.status(), `seed-connection failed: ${await seedRes.text()}`).toBe(201);
    const { id: connectionId } = (await seedRes.json()) as { id: string };

    // Hoist the Sage sender pair into the server's process env so
    // `resolveSageCredentials` can find them. The dispatcher reads them
    // at request time, not boot time, so this take effect immediately.
    process.env.SAGE_INTACCT_SENDER_ID = process.env.SAGE_INTACCT_SANDBOX_SENDER_ID;
    process.env.SAGE_INTACCT_SENDER_PASSWORD = process.env.SAGE_INTACCT_SANDBOX_SENDER_PASSWORD;

    const localInvoiceId = `e2e-sage-${Date.now()}`;
    const docNumber = `E2E-${Date.now().toString().slice(-8)}`;
    const customerRef = process.env.SAGE_INTACCT_SANDBOX_CUSTOMER_ID || "C-001";
    const amount = 198.76;

    const syncRes = await page.request.post(
      `${BASE_URL}/api/integrations/connections/${connectionId}/sync`,
      {
        data: {
          operation: "sage_invoice",
          dryRun: false,
          data: {
            invoice: {
              localInvoiceId,
              customerRef,
              docNumber,
              lineItems: [
                { description: "SmartManage e2e round-trip", amount, costCode: "GENERAL" },
              ],
            },
          },
        },
      },
    );
    expect(syncRes.status(), `sync failed: ${await syncRes.text()}`).toBe(200);
    const syncJson = await syncRes.json();
    const innerResult = syncJson?.result ?? syncJson;
    expect(innerResult.success).toBeTruthy();

    // Poll Sage for the AR invoice we just pushed via RECORDID lookup
    // — Sage returns RECORDID == docNumber from `exportInvoice`.
    let sageInvoiceXml: string | undefined;
    const deadline = Date.now() + 10_000;
    while (!sageInvoiceXml && Date.now() < deadline) {
      const xml = await sageSandboxReadByQuery({
        object: "ARINVOICE",
        query: `RECORDID = '${docNumber}'`,
        fields: "RECORDID,RECORDNO,TOTALENTERED,TOTALDUE,CUSTOMERID,STATE",
      });
      if (xml.includes("<arinvoice>") || xml.includes("<ARINVOICE>")) {
        sageInvoiceXml = xml;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(sageInvoiceXml, `AR invoice ${docNumber} not found in Sage sandbox`).toBeTruthy();
    // Lightweight assertions on the raw XML — pulling in fast-xml-parser
    // here would duplicate the server-side parser; the substring checks
    // are enough to prove the round-trip carried the customer and the
    // total over the wire intact.
    expect(sageInvoiceXml).toContain(`<RECORDID>${docNumber}</RECORDID>`);
    expect(sageInvoiceXml).toContain(`<CUSTOMERID>${customerRef}</CUSTOMERID>`);
    const totalMatch = sageInvoiceXml!.match(/<TOTALENTERED>([0-9.]+)<\/TOTALENTERED>/);
    expect(totalMatch).toBeTruthy();
    expect(Number(totalMatch![1])).toBeCloseTo(amount, 2);
  });
});
