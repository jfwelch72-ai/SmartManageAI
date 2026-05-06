import { describe, it, expect } from "vitest";
import type { Response } from "express";
import {
  paginationSchema,
  parsePagination,
  encodeCursor,
  decodeCursor,
  setNextLinkHeader,
  buildPage,
  PaginationError,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from "../utils/pagination";

describe("paginationSchema", () => {
  it("rejects pageSize above the cap", () => {
    const result = paginationSchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 });
    expect(result.success).toBe(false);
    expect(() => parsePagination({ pageSize: 99999 })).toThrow(PaginationError);
    try {
      parsePagination({ pageSize: 99999 });
    } catch (e) {
      expect((e as PaginationError).status).toBe(400);
    }
  });

  it("accepts edges (1, MAX, default)", () => {
    expect(parsePagination({ pageSize: 1 }).pageSize).toBe(1);
    expect(parsePagination({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsePagination({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("rejects malformed cursor strings", () => {
    expect(() => parsePagination({ cursor: "not-base64-json!!!" })).toThrow(
      PaginationError,
    );
  });
});

describe("encodeCursor / decodeCursor", () => {
  it("round-trips ts + id", () => {
    const c = { ts: "2026-05-05T12:34:56.789Z", id: "01HZX5J3-ABCDEF" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it("returns null for empty/garbage input", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
    expect(decodeCursor(Buffer.from("not json", "utf8").toString("base64url")))
      .toBeNull();
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ ts: "nope", id: "x" }), "utf8")
        .toString("base64url")),
    ).toBeNull();
  });
});

describe("buildPage", () => {
  it("emits nextCursor only when an overflow row was fetched", () => {
    // Caller fetches pageSize+1; the extra row is the existence signal.
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      updatedAt: `2026-05-05T0${i}:00:00.000Z`,
    }));
    const overflowed = buildPage(rows, 5, (r) => ({ ts: r.updatedAt, id: r.id }));
    expect(overflowed.items).toHaveLength(5);
    expect(overflowed.items[overflowed.items.length - 1].id).toBe("r4");
    expect(decodeCursor(overflowed.nextCursor!)).toEqual({
      ts: "2026-05-05T04:00:00.000Z",
      id: "r4",
    });
  });

  it("does not emit nextCursor on an exact-boundary last page", () => {
    // Only pageSize rows came back → there is no next row, so no cursor.
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      updatedAt: `2026-05-05T0${i}:00:00.000Z`,
    }));
    const exact = buildPage(rows, 5, (r) => ({ ts: r.updatedAt, id: r.id }));
    expect(exact.items).toHaveLength(5);
    expect(exact.nextCursor).toBeNull();

    const partial = buildPage(rows, 10, (r) => ({ ts: r.updatedAt, id: r.id }));
    expect(partial.nextCursor).toBeNull();
  });

  it("includes total only when supplied", () => {
    const p1 = buildPage([], 50, () => ({ ts: "", id: "" }));
    expect(p1).not.toHaveProperty("total");
    const p2 = buildPage([], 50, () => ({ ts: "", id: "" }), 1234);
    expect(p2.total).toBe(1234);
  });
});

describe("setNextLinkHeader", () => {
  function makeRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      res: {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      } as unknown as Response,
    };
  }

  it("sets Link rel=next preserving other query params", () => {
    const { res, headers } = makeRes();
    setNextLinkHeader(res, "/api/crm/contacts?search=foo&pageSize=200", "CUR1");
    expect(headers.Link).toBe(
      '</api/crm/contacts?search=foo&pageSize=200&cursor=CUR1>; rel="next"',
    );
  });

  it("omits the header when there is no next page", () => {
    const { res, headers } = makeRes();
    setNextLinkHeader(res, "/api/crm/contacts?pageSize=200", null);
    expect(headers.Link).toBeUndefined();
  });

  it("strips offset/page params when handing out a cursor", () => {
    const { res, headers } = makeRes();
    setNextLinkHeader(res, "/api/audit-logs?page=3&offset=60&pageSize=20", "C2");
    expect(headers.Link).toContain("cursor=C2");
    expect(headers.Link).not.toContain("page=");
    expect(headers.Link).not.toContain("offset=");
  });
});

describe("same-timestamp tie-break", () => {
  it("splits rows sharing one ts deterministically by id", () => {
    const SHARED_TS = "2026-05-05T12:00:00.000Z";
    const rows = [
      { id: "id-z", updatedAt: SHARED_TS },
      { id: "id-y", updatedAt: SHARED_TS },
      { id: "id-x", updatedAt: SHARED_TS },
      { id: "id-w", updatedAt: SHARED_TS },
    ];
    // Caller fetched pageSize+1 = 3 rows → buildPage trims to 2 + cursor.
    const page1 = buildPage(rows.slice(0, 3), 2, (r) => ({
      ts: r.updatedAt,
      id: r.id,
    }));
    expect(page1.items.map((r) => r.id)).toEqual(["id-z", "id-y"]);
    const cur = decodeCursor(page1.nextCursor!)!;
    expect(cur).toEqual({ ts: SHARED_TS, id: "id-y" });

    const page2Source = rows.filter((r) => {
      if (r.updatedAt < cur.ts) return true;
      if (r.updatedAt === cur.ts && r.id < cur.id) return true;
      return false;
    });
    expect(page2Source.map((r) => r.id)).toEqual(["id-x", "id-w"]);
    const page2 = buildPage(page2Source, 2, (r) => ({
      ts: r.updatedAt,
      id: r.id,
    }));
    expect(page2.nextCursor).toBeNull();

    const seen = [
      ...page1.items.map((r) => r.id),
      ...page2.items.map((r) => r.id),
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });
});

describe("10k-row sweep", () => {
  it("walks 10,000 rows across 50 pages of 200 with no skips or dupes", () => {
    const TOTAL = 10_000;
    const PAGE = 200;
    const baseTs = Date.parse("2026-01-01T00:00:00Z");
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      id: `row-${String(TOTAL - i).padStart(6, "0")}`,
      // 10 rows per ts forces the id tie-breaker on most page boundaries.
      updatedAt: new Date(baseTs + Math.floor(i / 10) * 60_000).toISOString(),
    })).sort((a, b) =>
      a.updatedAt === b.updatedAt
        ? b.id.localeCompare(a.id)
        : b.updatedAt.localeCompare(a.updatedAt),
    );

    const seen = new Set<string>();
    let cursor: { ts: string; id: string } | null = null;
    let pages = 0;
    while (true) {
      const slice = (cursor === null
        ? all
        : all.filter((r) => {
            if (r.updatedAt < cursor!.ts) return true;
            if (r.updatedAt === cursor!.ts && r.id < cursor!.id) return true;
            return false;
          })
      ).slice(0, PAGE + 1); // simulate the pageSize+1 fetch
      if (slice.length === 0) break;
      pages += 1;
      const page = buildPage(slice, PAGE, (r) => ({
        ts: r.updatedAt,
        id: r.id,
      }));
      for (const r of page.items) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
      if (pages > 60) throw new Error("pagination did not terminate");
    }
    expect(pages).toBe(50);
    expect(seen.size).toBe(TOTAL);
  });
});

describe("two-page disjoint round-trip", () => {
  it("a (ts,id) cursor never repeats or skips a row", () => {
    const rows = [
      { id: "f", updatedAt: "2026-05-05T06:00:00.000Z" },
      { id: "e", updatedAt: "2026-05-05T05:00:00.000Z" },
      { id: "d", updatedAt: "2026-05-05T04:00:00.000Z" },
      { id: "c", updatedAt: "2026-05-05T03:00:00.000Z" },
      { id: "b", updatedAt: "2026-05-05T02:00:00.000Z" },
      { id: "a", updatedAt: "2026-05-05T01:00:00.000Z" },
    ];
    // Fetch pageSize+1 = 4 rows for page 1; buildPage trims to 3 + cursor.
    const page1 = buildPage(rows.slice(0, 4), 3, (r) => ({
      ts: r.updatedAt,
      id: r.id,
    }));
    expect(page1.items.map((r) => r.id)).toEqual(["f", "e", "d"]);
    const cur = decodeCursor(page1.nextCursor!)!;
    expect(cur).toEqual({ ts: "2026-05-05T04:00:00.000Z", id: "d" });

    const page2Source = rows.filter((r) => {
      if (r.updatedAt < cur.ts) return true;
      if (r.updatedAt === cur.ts && r.id < cur.id) return true;
      return false;
    });
    const page2 = buildPage(page2Source, 3, (r) => ({
      ts: r.updatedAt,
      id: r.id,
    }));
    expect(page2.items.map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(page2.nextCursor).toBeNull();

    const ids1 = new Set(page1.items.map((r) => r.id));
    for (const r of page2.items) expect(ids1.has(r.id)).toBe(false);
  });
});
