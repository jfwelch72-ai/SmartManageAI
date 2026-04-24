// Sage Intacct Phase A unit tests (XML helpers + sync gating).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildSageEnvelope,
  parseSageResponse,
  resolveSageCredentials,
  sageRequest,
  sageGateway,
  SageGatewayError,
  type SageCredentials,
} from "../integrations/providers/sage/xmlGateway";
import {
  extractRecords,
  processSagePeriodicSync,
} from "../integrations/providers/sage/sync";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

const baseCreds: SageCredentials = {
  senderId: "SMARTMANAGE",
  senderPassword: "sender-pw",
  userId: "ws-user",
  userPassword: "ws-pw",
  companyId: "COMPANY",
};

describe("buildSageEnvelope", () => {
  it("serialises control + authentication + multiple functions with controlids", () => {
    const xml = buildSageEnvelope(
      baseCreds,
      [
        { name: "readByQuery", body: { object: "GLACCOUNT" }, controlId: "coa" },
        { name: "create", body: { CUSTOMER: { CUSTOMERID: "C1", NAME: "Acme" } } },
      ],
      { uniqueId: "test-1", dtdVersion: "3.0" },
    );

    expect(xml).toContain("<senderid>SMARTMANAGE</senderid>");
    expect(xml).toContain("<password>sender-pw</password>");
    expect(xml).toContain("<dtdversion>3.0</dtdversion>");
    expect(xml).toContain("<controlid>test-1</controlid>");
    expect(xml).toContain("<userid>ws-user</userid>");
    expect(xml).toContain("<companyid>COMPANY</companyid>");
    expect(xml).toContain('controlid="coa"');
    expect(xml).toContain('controlid="test-1-fn2"');
    expect(xml).toContain("<readByQuery>");
    expect(xml).toContain("<object>GLACCOUNT</object>");
    expect(xml).toContain("<CUSTOMERID>C1</CUSTOMERID>");
    expect(xml).toContain("<NAME>Acme</NAME>");
  });

  it("includes locationid only when provided", () => {
    const without = buildSageEnvelope(baseCreds, [{ name: "x", body: "y" }]);
    expect(without).not.toContain("<locationid>");

    const with_ = buildSageEnvelope(
      { ...baseCreds, locationId: "LOC-1" },
      [{ name: "x", body: "y" }],
    );
    expect(with_).toContain("<locationid>LOC-1</locationid>");
  });
});

describe("sageGateway typed wrappers", () => {
  function makeOkXml(): string {
    return `<?xml version="1.0"?>
      <response>
        <control><status>success</status><controlid>top</controlid></control>
        <operation>
          <authentication><status>success</status></authentication>
          <result>
            <status>success</status>
            <controlid>r</controlid>
            <data />
          </result>
        </operation>
      </response>`;
  }

  function makeFetch(captured: { body?: string }) {
    return vi.fn(async (_url: string, init: any) => {
      captured.body = String(init?.body || "");
      return { ok: true, status: 200, text: async () => makeOkXml() } as any;
    });
  }

  it("inspect → builds <inspect><object>...</object></inspect> envelope", async () => {
    const captured: { body?: string } = {};
    const fetchImpl = makeFetch(captured);
    const r = await sageGateway.inspect(baseCreds, "GLACCOUNT", { fetchImpl });
    expect(r.success).toBe(true);
    expect(captured.body).toContain("<inspect>");
    expect(captured.body).toContain("<object>GLACCOUNT</object>");
    expect(captured.body).not.toContain("<payload>");
  });

  it("read → joins keys array with commas", async () => {
    const captured: { body?: string } = {};
    const fetchImpl = makeFetch(captured);
    await sageGateway.read(
      baseCreds,
      { object: "ARINVOICE", keys: ["1", "2", "3"], fields: "RECORDNO,WHENDUE" },
      { fetchImpl },
    );
    expect(captured.body).toContain("<read>");
    expect(captured.body).toContain("<keys>1,2,3</keys>");
    expect(captured.body).toContain("<fields>RECORDNO,WHENDUE</fields>");
  });

  it("readByQuery → emits empty <query/> when no query is supplied", async () => {
    const captured: { body?: string } = {};
    const fetchImpl = makeFetch(captured);
    await sageGateway.readByQuery(
      baseCreds,
      { object: "CUSTOMER", pagesize: 50 },
      { fetchImpl },
    );
    expect(captured.body).toContain("<readByQuery>");
    expect(captured.body).toMatch(/<query\s*\/?>(<\/query>)?/);
    expect(captured.body).toContain("<pagesize>50</pagesize>");
  });

  it("create / update → wrap their nested body in <create>/<update> envelopes", async () => {
    const captured: { body?: string } = {};
    const fetchImpl = makeFetch(captured);
    await sageGateway.create(
      baseCreds,
      { CUSTOMER: { CUSTOMERID: "C1", NAME: "Acme" } },
      { fetchImpl },
    );
    expect(captured.body).toContain("<create>");
    expect(captured.body).toContain("<CUSTOMER>");
    expect(captured.body).toContain("<CUSTOMERID>C1</CUSTOMERID>");

    captured.body = undefined;
    await sageGateway.update(
      baseCreds,
      { CUSTOMER: { CUSTOMERID: "C1", NAME: "Acme Inc" } },
      { fetchImpl },
    );
    expect(captured.body).toContain("<update>");
    expect(captured.body).toContain("<NAME>Acme Inc</NAME>");
  });
});

describe("parseSageResponse", () => {
  it("returns success + per-controlid data when every function succeeds", () => {
    const xml = `<?xml version="1.0"?>
      <response>
        <control><status>success</status><controlid>top</controlid></control>
        <operation>
          <authentication><status>success</status></authentication>
          <result>
            <status>success</status>
            <controlid>coa</controlid>
            <data>
              <glaccount><RECORDNO>1</RECORDNO><TITLE>Cash</TITLE></glaccount>
              <glaccount><RECORDNO>2</RECORDNO><TITLE>AR</TITLE></glaccount>
            </data>
          </result>
        </operation>
      </response>`;
    const parsed = parseSageResponse<Record<string, any>>(xml);
    expect(parsed.success).toBe(true);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.data.coa).toBeTruthy();
  });

  it("aggregates per-function errors and tags them with controlid", () => {
    const xml = `<?xml version="1.0"?>
      <response>
        <control><status>success</status></control>
        <operation>
          <authentication><status>success</status></authentication>
          <result>
            <status>failure</status>
            <controlid>cust-9</controlid>
            <errormessage>
              <error><errorno>BL01001973</errorno><description2>Customer ID already exists</description2></error>
            </errormessage>
          </result>
        </operation>
      </response>`;
    const parsed = parseSageResponse(xml);
    expect(parsed.success).toBe(false);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].controlId).toBe("cust-9");
    expect(parsed.errors[0].message).toContain("Customer ID already exists");
  });

  it("flags authentication failure", () => {
    const xml = `<?xml version="1.0"?>
      <response>
        <control><status>success</status></control>
        <operation>
          <authentication><status>failure</status></authentication>
          <errormessage>
            <error><description2>Invalid web services user</description2></error>
          </errormessage>
        </operation>
      </response>`;
    const parsed = parseSageResponse(xml);
    expect(parsed.success).toBe(false);
    expect(parsed.errors[0].message).toContain("Invalid web services user");
  });
});

describe("resolveSageCredentials", () => {
  let savedSenderId: string | undefined;
  let savedSenderPw: string | undefined;
  beforeEach(() => {
    savedSenderId = process.env.SAGE_INTACCT_SENDER_ID;
    savedSenderPw = process.env.SAGE_INTACCT_SENDER_PASSWORD;
  });
  afterEach(() => {
    if (savedSenderId === undefined) delete process.env.SAGE_INTACCT_SENDER_ID;
    else process.env.SAGE_INTACCT_SENDER_ID = savedSenderId;
    if (savedSenderPw === undefined) delete process.env.SAGE_INTACCT_SENDER_PASSWORD;
    else process.env.SAGE_INTACCT_SENDER_PASSWORD = savedSenderPw;
  });

  it("throws when sender env missing", () => {
    delete process.env.SAGE_INTACCT_SENDER_ID;
    delete process.env.SAGE_INTACCT_SENDER_PASSWORD;
    expect(() =>
      resolveSageCredentials({ companyId: "C", userId: "U", userPassword: "P" }),
    ).toThrow(/SAGE_INTACCT_SENDER_ID/);
  });

  it("throws when per-tenant credentials missing", () => {
    process.env.SAGE_INTACCT_SENDER_ID = "S";
    process.env.SAGE_INTACCT_SENDER_PASSWORD = "P";
    expect(() => resolveSageCredentials({})).toThrow(/per-tenant/);
  });

  it("merges env + metadata into a complete bundle", () => {
    process.env.SAGE_INTACCT_SENDER_ID = "S";
    process.env.SAGE_INTACCT_SENDER_PASSWORD = "P";
    const creds = resolveSageCredentials({
      companyId: "ACME",
      userId: "ws-user",
      userPassword: "ws-pw",
      locationId: "LOC1",
    });
    expect(creds).toEqual({
      senderId: "S",
      senderPassword: "P",
      companyId: "ACME",
      userId: "ws-user",
      userPassword: "ws-pw",
      locationId: "LOC1",
    });
  });
});

describe("extractRecords", () => {
  it("normalises the single-row shape", () => {
    const single = { glaccount: { RECORDNO: "1", TITLE: "Cash" } };
    expect(extractRecords(single, "glaccount")).toEqual([{ RECORDNO: "1", TITLE: "Cash" }]);
  });
  it("preserves multi-row arrays", () => {
    const multi = {
      glaccount: [
        { RECORDNO: "1", TITLE: "Cash" },
        { RECORDNO: "2", TITLE: "AR" },
      ],
    };
    expect(extractRecords(multi, "glaccount")).toHaveLength(2);
  });
  it("returns [] for empty / null payloads", () => {
    expect(extractRecords(null, "glaccount")).toEqual([]);
    expect(extractRecords(undefined, "glaccount")).toEqual([]);
    expect(extractRecords({}, "glaccount")).toEqual([]);
  });
});

describe("SageGatewayError + sageRequest retry/backoff", () => {
  it("4xx errors are not retried and surface with retryable=false", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response("bad creds", { status: 401 });
    });
    await expect(
      sageRequest(baseCreds, [{ name: "x", body: "y" }], {
        fetchImpl: fetchImpl as any,
        maxAttempts: 3,
        retryBackoffMs: [0, 0, 0],
      }),
    ).rejects.toMatchObject({
      name: "SageGatewayError",
      status: 401,
      retryable: false,
    });
    expect(calls).toBe(1);
  });

  it("retries on 5xx and surfaces retryable=true after exhausting attempts", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return new Response("upstream down", { status: 503 });
    });
    await expect(
      sageRequest(baseCreds, [{ name: "x", body: "y" }], {
        fetchImpl: fetchImpl as any,
        maxAttempts: 3,
        retryBackoffMs: [0, 0, 0],
      }),
    ).rejects.toMatchObject({ name: "SageGatewayError", status: 503, retryable: true });
    expect(calls).toBe(3);
  });

  it("recovers when a 5xx is followed by a 2xx", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("transient", { status: 502 });
      return new Response(
        `<?xml version="1.0"?>
<response>
  <control><status>success</status></control>
  <operation>
    <authentication><status>success</status></authentication>
    <result>
      <status>success</status>
      <controlid>x</controlid>
      <data><foo><n>1</n></foo></data>
    </result>
  </operation>
</response>`,
        { status: 200 },
      );
    });
    const out = await sageRequest(baseCreds, [{ name: "x", body: "y", controlId: "x" }], {
      fetchImpl: fetchImpl as any,
      maxAttempts: 3,
      retryBackoffMs: [0, 0, 0],
    });
    expect(out.success).toBe(true);
    expect(calls).toBe(2);
  });

  it("network errors (AbortError, fetch reject) are wrapped as retryable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(
      sageRequest(baseCreds, [{ name: "x", body: "y" }], {
        fetchImpl: fetchImpl as any,
        maxAttempts: 2,
        retryBackoffMs: [0],
      }),
    ).rejects.toMatchObject({ name: "SageGatewayError", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("typed error class exposes status/retryable/bodyExcerpt fields", () => {
    const e = new SageGatewayError("boom", { status: 500, retryable: true, bodyExcerpt: "x" });
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(500);
    expect(e.retryable).toBe(true);
    expect(e.bodyExcerpt).toBe("x");
  });
});

describe("processSagePeriodicSync feature-flag gate", () => {
  let savedFlag: string | undefined;
  beforeEach(() => {
    savedFlag = process.env.INTEGRATION_SAGE;
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.INTEGRATION_SAGE;
    else process.env.INTEGRATION_SAGE = savedFlag;
  });

  it("returns a zero-attempt summary when INTEGRATION_SAGE is off", async () => {
    delete process.env.INTEGRATION_SAGE;
    const out = await processSagePeriodicSync();
    expect(out).toEqual({ attempted: 0, succeeded: 0, failed: 0, failures: [] });
  });

  it("returns a zero-attempt summary when INTEGRATION_SAGE is anything other than 'true'", async () => {
    process.env.INTEGRATION_SAGE = "false";
    const out = await processSagePeriodicSync();
    expect(out.attempted).toBe(0);
  });
});
