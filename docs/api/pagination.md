# Pagination on List Endpoints (Task #2430)

This document describes the pagination contract enforced on every list
endpoint exposed by the API. The goal is a single, predictable shape so
clients can rely on cursor-based scrolling, the table virtualizer in the
React app can fetch deterministically, and we never accidentally ship a
route that returns an unbounded array.

## Contract

A paginated request accepts the following query parameters (all
optional; validated by `paginationSchema` in `server/utils/pagination.ts`):

| param      | type    | default | constraint                                |
|------------|---------|---------|-------------------------------------------|
| `cursor`   | string  | _none_  | base64url(JSON `{ts, id}`) opaque token   |
| `pageSize` | integer | 50      | `1..200` (cap = `MAX_PAGE_SIZE`)          |
| `page`     | integer | _none_  | offset-mode fallback only (legacy)        |

A paginated response is an envelope:

```json
{
  "items": [ /* row objects, ordered (sortField DESC, id DESC) */ ],
  "nextCursor": "eyJ0cyI6IjIwMjYtMDUtMDVUMTI6MDA6MDAuMDAwWiIsImlkIjoiYWJjIn0",
  "total": 4127
}
```

* `items` — the page of rows.
* `nextCursor` — opaque token to pass back as `?cursor=` to fetch the
  next page. `null` when there are no more rows.
* `total` — optional, set when the route has a cheap count query.

Servers also set `Link: <…>; rel="next"` whenever a next page exists,
so clients that prefer header-driven pagination (curl scripts,
integrations) can follow links without parsing the body.

## Why opt-in envelope?

Existing clients call `/api/crm/contacts` and consume an array. We
detect pagination intent via the presence of `cursor` _or_ `pageSize`
in the query string. When present, the server returns the envelope.
When absent, the legacy array shape is preserved. This lets us migrate
heavy pages incrementally without breaking smaller callers.

## Cursor format

Cursors are base64url-encoded JSON of the form `{"ts": ISOString, "id": string}`.

* `ts` is the value of the primary sort column (`updatedAt` for CRM
  contacts, `createdAt` for audit logs and transcript jobs).
* `id` is the row primary key, used as a tiebreaker so duplicate
  timestamps don't drop or repeat rows.

The `cursorWhere` helper translates a decoded cursor into a Drizzle
predicate `(ts, id) < (cursor.ts, cursor.id)` so the next page is
fully disjoint from the previous one.

## Paginated endpoints

| route                                                 | sort                   | envelope opt-in                |
|-------------------------------------------------------|------------------------|--------------------------------|
| `GET /api/audit-logs`                                 | `createdAt DESC, id`   | `?cursor=` or `?pageSize=`     |
| `GET /api/crm/contacts`                               | `updatedAt DESC, id`   | `?cursor=` or `?pageSize=`     |
| `GET /api/crm/calls/transcripts/backfill/history`     | `createdAt DESC, id`   | `?cursor=` or `?pageSize=`     |

## Author checklist for new list endpoints

- [ ] Import `parsePagination`, `cursorWhere`, `setNextLinkHeader`,
      `buildPage` from `server/utils/pagination.ts`.
- [ ] Validate the request with `parsePagination(req.query)`.
- [ ] Add a stable secondary sort on the primary key
      (`orderBy(desc(table.sortColumn), desc(table.id))`).
- [ ] Apply `cursorWhere(table.sortColumn, table.id, params.cursor)`
      to the query when present.
- [ ] Fetch `params.pageSize + 1` rows so you can detect the next page
      cheaply without an extra `COUNT(*)`.
- [ ] Call `setNextLinkHeader(req, res, nextCursor)`.
- [ ] Return `buildPage(rows, params.pageSize, total?)`.
- [ ] If existing clients rely on the legacy array shape, gate the
      envelope on the presence of `cursor` or `pageSize` and keep the
      legacy path intact (see `crmRoutes.ts` for the canonical pattern).
- [ ] Add a regression test that asserts `pageSize > 200` returns
      `400 Bad Request` and that two consecutive pages contain disjoint
      row sets.

## Remaining list endpoints (follow-up backlog)

The three pilots above are the only routes migrated under Task #2430.
The list below is the backlog of remaining list endpoints, ranked by
the row count we observe in the production audit-log + crm tables and
in the highest-traffic tenants. Each item should be migrated by
following the author checklist above. Tracked here so the work is
visible without grepping the codebase.

| rank | route                                                  | est. rows | sort column        |
|------|--------------------------------------------------------|-----------|--------------------|
| 1    | `GET /api/notifications`                               | very high | `createdAt DESC`   |
| 2    | `GET /api/messages`                                    | very high | `createdAt DESC`   |
| 3    | `GET /api/projects/:id/daily-reports`                  | high      | `reportDate DESC`  |
| 4    | `GET /api/time-entries`                                | high      | `clockIn DESC`     |
| 5    | `GET /api/projects/:id/photos`                         | high      | `takenAt DESC`     |
| 6    | `GET /api/crm/companies`                               | medium    | `updatedAt DESC`   |
| 7    | `GET /api/crm/opportunities`                           | medium    | `updatedAt DESC`   |
| 8    | `GET /api/projects/:id/rfis`                           | medium    | `createdAt DESC`   |
| 9    | `GET /api/projects/:id/submittals`                     | medium    | `createdAt DESC`   |
| 10   | `GET /api/projects/:id/change-orders`                  | medium    | `createdAt DESC`   |
| 11   | `GET /api/projects/:id/punch-list`                     | medium    | `createdAt DESC`   |
| 12   | `GET /api/projects/:id/drawings`                       | medium    | `uploadedAt DESC`  |
| 13   | `GET /api/projects`                                    | low–med   | `updatedAt DESC`   |
| 14   | `GET /api/bids`                                        | low–med   | `dueDate DESC`     |
| 15   | `GET /api/estimates`                                   | low–med   | `updatedAt DESC`   |

When picking up an item: open a follow-up task referencing #2430,
migrate the route + its primary client consumer in the same PR, and
move the row out of this table.

## Client-side checklist

- [ ] Use `useInfiniteQuery` from `@tanstack/react-query` keyed on the
      filter set with `paginated: true` so pagination caches don't
      collide with legacy array caches.
- [ ] Set `initialPageParam: null` and `getNextPageParam: (last) =>
      last.nextCursor ?? undefined`.
- [ ] Send `pageSize=200` (the server cap) so a full table fits in
      ≤50 round trips.
- [ ] For tables expected to exceed ~500 rows, render with
      `useVirtualizer` from `@tanstack/react-virtual` and use the
      padding-row pattern (see `client/src/pages/crm.tsx` for the
      contacts table reference implementation).
