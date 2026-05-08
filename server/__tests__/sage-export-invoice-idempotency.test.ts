// Task #1605 — DB-backed idempotency coverage for Sage Intacct
// `exportInvoice`. The unit-level envelope/parse/credential coverage lives
// in `sage-sync.test.ts`; this suite locks down the round-trip against the
// real `integration_sync_state` table so a regression that drops the
// `exportedIds` / `idMapping` metadata (and therefore re-pushes an invoice
// every time) fails CI instead of silently double-billing customers.
//
// Per the task contract, only the network layer is mocked: a stubbed
// `fetchImpl` is injected through the new `SageSyncOptions` seam on
// `exportInvoice`. Everything else (`resolveSageCredentials`,
// `getExportedIds` / `trackExportedId`, the `integration_sync_state`
// upsert, even the audit + logger calls) runs unmocked against the same
// Postgres the rest of the server suite uses.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { sql, and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  type IntegrationConnection,
} from "@shared/schema";
import { exportInvoice } from "../integrations/providers/sage/sync";

const PREFIX = "__sageinv__";

interface SageSyncStateMetadata {
  exportedIds?: string[];
  idMapping?: Record<string, string>;
  lastExportAt?: string;
}

function makeOkXml(localInvoiceId: string, sageRecordNo: string): string {
  // Sage's create-AR-invoice envelope returns the new RECORDNO (numeric
  // primary key) inside `<data><arinvoice><key>…</key></arinvoice>`
  // addressed by the function's controlid. `extractCreatedKey` accepts
  // `key`, `KEY`, `recordno`, or `RECORDNO`; we use `key` here so the test
  // matches the real Intacct response shape verbatim.
  return `<?xml version="1.0"?>
<response>
  <control><status>success</status><controlid>top</controlid></control>
  <operation>
    <authentication><status>success</status></authentication>
    <result>
      <status>success</status>
      <controlid>inv-${localInvoiceId}</controlid>
      <data>
        <arinvoice>
          <key>${sageRecordNo}</key>
          <RECORDNO>${sageRecordNo}</RECORDNO>
        </arinvoice>
      </data>
    </result>
  </operation>
</response>`;
}

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db
      .delete(integrationSyncState)
      .where(eq(integrationSyncState.organizationId, id));
    await db
      .delete(integrationConnections)
      .where(eq(integrationConnections.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

let connection: IntegrationConnection;
let savedSenderId: string | undefined;
let savedSenderPw: string | undefined;

beforeAll(async () => {
  await cleanup();

  savedSenderId = process.env.SAGE_INTACCT_SENDER_ID;
  savedSenderPw = process.env.SAGE_INTACCT_SENDER_PASSWORD;
  process.env.SAGE_INTACCT_SENDER_ID = "TEST_SENDER";
  process.env.SAGE_INTACCT_SENDER_PASSWORD = "test-sender-pw";

  const [org] = await db
    .insert(organizations)
    .values({
      name: `${PREFIX}org`,
      slug: `${PREFIX}org-${Date.now()}`,
    })
    .returning();

  const [conn] = await db
    .insert(integrationConnections)
    .values({
      organizationId: org.id,
      provider: "sage_intacct",
      status: "active",
      displayName: "sage idempotency test",
      metadata: {
        companyId: "ACME",
        userId: "ws-user",
        userPassword: "ws-pw",
      },
    })
    .returning();
  connection = conn;
});

afterAll(async () => {
  await cleanup();
  if (savedSenderId === undefined) delete process.env.SAGE_INTACCT_SENDER_ID;
  else process.env.SAGE_INTACCT_SENDER_ID = savedSenderId;
  if (savedSenderPw === undefined)
    delete process.env.SAGE_INTACCT_SENDER_PASSWORD;
  else process.env.SAGE_INTACCT_SENDER_PASSWORD = savedSenderPw;
});

beforeEach(async () => {
  await db
    .delete(integrationSyncState)
    .where(eq(integrationSyncState.connectionId, connection.id));
});

async function getInvoiceSyncState(): Promise<
  { metadata: SageSyncStateMetadata } | undefined
> {
  const [row] = await db
    .select()
    .from(integrationSyncState)
    .where(
      and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, "exported_sage_invoices"),
      ),
    );
  if (!row) return undefined;
  return { metadata: (row.metadata ?? {}) as SageSyncStateMetadata };
}

describe("exportInvoice idempotency (DB-backed)", () => {
  it("first export hits Sage, persists the local→RECORDNO mapping, second export short-circuits", async () => {
    const localInvoiceId = `${PREFIX}inv-1`;
    const sageRecordNo = "987654";

    const requestBodies: string[] = [];
    const fetchStub = vi.fn(
      async (_url, init) => {
        const body = init?.body;
        requestBodies.push(typeof body === "string" ? body : "");
        return new Response(makeOkXml(localInvoiceId, sageRecordNo), {
          status: 200,
        });
      },
    );

    const first = await exportInvoice(
      connection,
      {
        customerRef: "C-1",
        docNumber: "INV-1001",
        localInvoiceId,
        lineItems: [{ description: "Mobilization", amount: 1000 }],
      },
      false,
      { fetchImpl: fetchStub as typeof fetch },
    );

    expect(first.success).toBe(true);
    expect(first.alreadyExported).toBeUndefined();
    expect(first.created).toBe(1);
    expect(first.sageInvoiceId).toBe(sageRecordNo);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    // The first call's envelope must be the AR invoice create — guards
    // against a regression where the function name / object key drifts.
    expect(requestBodies[0]).toContain("<create>");
    expect(requestBodies[0]).toContain("<ARINVOICE>");
    expect(requestBodies[0]).toContain("<CUSTOMERID>C-1</CUSTOMERID>");
    expect(requestBodies[0]).toContain("<RECORDID>INV-1001</RECORDID>");

    // Persistence: integration_sync_state row contains the local→Sage map.
    const persisted = await getInvoiceSyncState();
    expect(persisted).toBeTruthy();
    expect(persisted!.metadata.exportedIds).toContain(localInvoiceId);
    expect(persisted!.metadata.idMapping?.[localInvoiceId]).toBe(sageRecordNo);
    expect(typeof persisted!.metadata.lastExportAt).toBe("string");

    // Second call with the same localInvoiceId must NOT hit Sage again
    // and must surface the cached sageInvoiceId via alreadyExported.
    const second = await exportInvoice(
      connection,
      {
        customerRef: "C-1",
        docNumber: "INV-1001",
        localInvoiceId,
        lineItems: [{ description: "Mobilization", amount: 1000 }],
      },
      false,
      { fetchImpl: fetchStub as typeof fetch },
    );
    expect(second.success).toBe(true);
    expect(second.alreadyExported).toBe(true);
    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(second.sageInvoiceId).toBe(sageRecordNo);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("a different localInvoiceId on the same connection performs a fresh export", async () => {
    const firstId = `${PREFIX}inv-A`;
    const secondId = `${PREFIX}inv-B`;
    const fetchStub = vi.fn(
      async (_url, init) => {
        const body = init?.body;
        const bodyText = typeof body === "string" ? body : "";
        const isFirst = bodyText.includes(firstId);
        return new Response(
          makeOkXml(isFirst ? firstId : secondId, isFirst ? "111" : "222"),
          { status: 200 },
        );
      },
    );

    await exportInvoice(
      connection,
      {
        customerRef: "C-2",
        localInvoiceId: firstId,
        lineItems: [{ description: "L1", amount: 100 }],
      },
      false,
      { fetchImpl: fetchStub as typeof fetch },
    );
    await exportInvoice(
      connection,
      {
        customerRef: "C-2",
        localInvoiceId: secondId,
        lineItems: [{ description: "L2", amount: 200 }],
      },
      false,
      { fetchImpl: fetchStub as typeof fetch },
    );

    expect(fetchStub).toHaveBeenCalledTimes(2);

    const persisted = await getInvoiceSyncState();
    expect(persisted).toBeTruthy();
    expect(persisted!.metadata.exportedIds).toEqual(
      expect.arrayContaining([firstId, secondId]),
    );
    expect(persisted!.metadata.idMapping?.[firstId]).toBe("111");
    expect(persisted!.metadata.idMapping?.[secondId]).toBe("222");
  });
});
