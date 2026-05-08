# Per-Domain Storage Seam (Task #2431)

## Status

**Monolith retired (Task #2672).** The legacy `server/storage.ts` (~2,240 LOC,
~75 exports) has been deleted. Its remaining exports were moved verbatim into
three per-domain seams alongside the original Bids pilot:

| Seam | Owners |
| ---- | ------ |
| `server/bids/storage.ts` + `server/bids/storage.drizzle.ts` | Bids domain (original pilot, see below). |
| `server/crm/transcriptBackfillStorage.ts` | CRM transcript backfill jobs, notification settings, alert-delivery pipeline, alert-failure fallback, org-admin alert helpers. |
| `server/executiveDigest/storage.ts` | Executive digest snapshot read/write helpers. |
| `server/dot/payItemPickerFacetsStorage.ts` | DOT pay-item picker facet aggregation. |

A CI freeze guard at `scripts/check-legacy-storage.mjs` (wired into
`scripts/ci.sh`) fails the build if `server/storage.ts` is recreated or if any
`server/*.ts` file imports a bare `./storage` / `../storage` (the
`server/bids/` directory is allowlisted because its `../storage` resolves to
the bids seam, not the deleted monolith).

The Bids pilot below remains the canonical pattern for new domain extractions
(typed `IStorage` interface + Drizzle implementation + tenancy at the seam).
The three seams added in Task #2672 are pure code-moves and currently expose
the same free-function shape the monolith did; future work can refactor each
into the full interface + Drizzle-class pattern as adoption needs warrant.

## Why

`server/storage.ts` had grown into a single multi-thousand-line god-class touched
by every route module. Routes also reached into `db` directly all over the
place, which made tenancy enforcement a per-call-site chore (one missed
`.where(eq(bids.gcOrganizationId, …))` and you'd ship a cross-org leak).

The seam introduced here:

1. Splits storage by **domain**, owned by a small interface, so each route file
   only depends on what it actually uses.
2. Carries the tenant **at the seam** (constructor) instead of the call site, so
   every method in a given storage instance is implicitly scoped.
3. Surfaces cross-org write attempts as a typed error
   (`CrossOrgAccessError`) that routes can map to a uniform `403`.

## Files (pilot)

| File                              | Role                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| `server/bids/storage.ts`          | `IBidStorage` interface, DTOs, `CrossOrgAccessError` class.             |
| `server/bids/storage.drizzle.ts`  | `BidStorageDrizzle` Drizzle implementation. Owns all `db` calls.        |
| `server/bidRoutes2.ts`            | Thin route handlers — **no `db` imports, no Drizzle queries**.          |
| `server/bids/__tests__/storage.test.ts` | Tenancy + cross-org-error contract tests.                         |

## Contract

```ts
// server/bids/storage.ts
export interface IBidStorage {
  listBidsWithEstimateSummary(): Promise<BidListRow[]>;
  getBidByCode(code: string): Promise<Bid | null>;
  getBidById(id: string): Promise<Bid | null>;
  createBid(data: InsertBid & { gcOrganizationId: string | null }): Promise<Bid>;
  updateBidByCode(code: string, patch: Record<string, unknown>): Promise<Bid | null>;
  deleteBidByCode(code: string): Promise<Bid | null>;
  // … plus estimates, sub/material quotes, documents, handoff, RFQ, convert-to-project, etc.
}

export class CrossOrgAccessError extends Error {
  constructor(message = "Cross-organization access denied") {
    super(message);
    this.name = "CrossOrgAccessError";
  }
}
```

```ts
// server/bids/storage.drizzle.ts
export class BidStorageDrizzle implements IBidStorage {
  constructor(private readonly orgId: string | null) {}
  // Every read applies a `gcOrganizationId = orgId` filter when orgId !== null.
  // Every write first loads the row, asserts ownership, and throws
  // CrossOrgAccessError on mismatch.
}
```

### Constructor semantics

| `orgId` value | Meaning                                                                 | Used by                                                          |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `string`      | Tenant-scoped. All reads filtered, all writes ownership-checked.        | Authenticated routes for `ADMIN`/`MANAGER`/`ESTIMATOR`/etc.      |
| `null`        | Unscoped. No filter applied; caller is trusted to be unscoped on purpose. | `SUPER_ADMIN` cross-org views and the public RFQ-response path.  |

The unscoped form is intentional and explicit — there is no hidden "default
org" — so a misuse is visible at the call site (`new BidStorageDrizzle(null)`).

### Route adoption pattern

```ts
// server/bidRoutes2.ts (excerpt)
function getBidStorage(req: AuthRequest, res: Response): BidStorageDrizzle | null {
  const filter = getOrgIdForFilter(req);
  if (filter.mustDenyAccess) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return new BidStorageDrizzle(filter.shouldFilter ? filter.orgId : null);
}

function handleStorageError(err: unknown, res: Response): boolean {
  if (err instanceof CrossOrgAccessError) {
    res.status(403).json({ error: "Forbidden" });
    return true;
  }
  return false;
}

router.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const storage = getBidStorage(req, res);
    if (!storage) return;
    const bid = await storage.getBidByCode(req.params.code);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    res.json(bid);
  } catch (err) {
    if (handleStorageError(err, res)) return;
    next(err);
  }
});
```

The public RFQ route bypasses the helper because the caller is not
authenticated — it constructs `new BidStorageDrizzle(null)` directly and only
exposes the methods designed for token-scoped access (`getSubQuoteByRfqToken`,
`updateSubQuoteResponseByToken`, etc.).

## What lives in storage vs. routes

**Storage owns:**

- Every `db.select / insert / update / delete` and every `db.transaction(...)`.
- The `convertBidToProject` transaction and all its side-effects on
  `projects`, `estimates`, `scope_items`, `scheduleOfValues`, draft contract
  insert, and Davis-Bacon wage-decision sync queueing.
- Tenancy filters and ownership assertions.

**Routes own:**

- Auth (`requireAuth`, `requireRole`), rate limiters, CSRF, validation
  (`zod`/`validateBody`), response shaping.
- Audit logging (`logAudit`), domain event emission (`eventBus.emit`),
  notifications via the existing `notifyXyz` helpers.
- HTTP error semantics and status codes (404 / 403 / 409 / 422).

This split keeps routes thin and testable without DB plumbing, while keeping
storage free of HTTP concerns.

## Behavior parity

The pilot is byte-identical to the previous behavior of `server/bidRoutes2.ts`
(originally ~3,681 lines of inline `db` calls). Notable preserved quirks:

- The `createBid` retry-on-`23505` regenerates the next code and retries once.
- The `send-rfq` legacy bug path (throws `undefined`) is preserved verbatim.
- Submit endpoint preserves the `₱` symbol used by the dollar-summary message.
- The bid-leveling endpoint sorts in JS after `SELECT *` to preserve current
  output order.
- The document tenancy gate inside the storage layer mirrors the pre-refactor
  check exactly (returns `null` rather than throwing for the cross-org read
  case the route already 404s on).

## Testing

`server/bids/__tests__/storage.test.ts` exercises the contract directly:

- `getBidById` returns the bid for a same-org caller and `null` for a
  cross-org caller.
- `listBidsWithEstimateSummary` filters by org for a scoped instance and
  returns both orgs for an unscoped (`null`) instance.
- `updateBidByCode` and `deleteBidByCode` against a foreign-org code throw
  `CrossOrgAccessError` (which routes map to `403`).
- `createBid` stamps the constructor's `orgId` and the row is invisible to a
  different-org storage instance.

Run with:

```sh
npx vitest run server/bids/__tests__/storage.test.ts
```

## Adopting this pattern for another domain

1. Create `server/<domain>/storage.ts` with an interface and the
   `CrossOrgAccessError` re-export (or import from `server/bids/storage.ts`).
2. Create `server/<domain>/storage.drizzle.ts` with the Drizzle implementation
   and a `constructor(orgId: string | null)`.
3. Replace `db.*` calls in the domain's route module with storage method calls
   obtained through a `getXyzStorage(req, res)` helper that uses
   `getOrgIdForFilter`.
4. Map `CrossOrgAccessError` → `403` via a shared `handleStorageError` helper.
5. Add a `server/<domain>/__tests__/storage.test.ts` mirroring the four
   tenancy/cross-org cases above.
6. Leave `server/storage.ts` alone — only the domain you migrated should stop
   reaching into it.
