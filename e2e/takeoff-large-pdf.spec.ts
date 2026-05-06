import { test, expect, type Page, type Request } from "@playwright/test";
import { installCsrf, authedRequest } from "./helpers/csrf";

/**
 * Task #2446 — End-to-end verification of the 25 GB takeoff PDF flow
 * against a *real* pre-uploaded fixture in GCS.
 *
 * ─── Why this is opt-in ──────────────────────────────────────────────
 * Synthesizing or pulling a 25 GB PDF on every PR is impractical
 * (storage cost, runtime, network). This spec is therefore gated by
 * `RUN_LARGE_PDF_E2E=1` so it never runs unless an operator explicitly
 * opts in against an environment that can reach the fixture bucket.
 *
 * Task #2405 already covers the unit-test surface (range-only page-
 * count, Range header parsing, device-aware tile budget, per-document
 * soft cap). The "25 GB fixture" verification step in that task plan
 * was deferred to this spec because the unit suite cannot prove that
 * an actual multi-GB file ends up:
 *   (a) producing a page count in <5 s,
 *   (b) returning a working signed URL via /pdf-url,
 *   (c) being read by pdfjs-in-the-worker via *direct* GCS range
 *       requests (the Express server should see <1 MB of proxy bytes,
 *       not 25 GB), and
 *   (d) keeping the device-aware tile cache under budget after a
 *       10-sheet flip sequence.
 *
 * ─── Required env vars ───────────────────────────────────────────────
 * `RUN_LARGE_PDF_E2E`             must be set to `"1"`
 * `LARGE_PDF_E2E_BUCKET`          GCS bucket name holding the fixture
 * `LARGE_PDF_E2E_OBJECT`          object name (path within the bucket)
 * `LARGE_PDF_E2E_FILE_NAME`       optional, defaults to the basename
 *                                 of `LARGE_PDF_E2E_OBJECT` and must
 *                                 end in `.pdf` so the server takes
 *                                 the page-count code path
 * `LARGE_PDF_E2E_PAGE_COUNT_MS`   optional, page-count budget in ms
 *                                 (default 5000 — the published budget)
 * `LARGE_PDF_E2E_FLIP_SHEETS`     optional, how many sheets to flip
 *                                 through (default 10)
 * `LARGE_PDF_E2E_HIGH_PAGE`       optional, 1-based page number used
 *                                 to prove range access works deep
 *                                 inside the file (default 250 — the
 *                                 page explicitly called out in the
 *                                 task description). The fixture must
 *                                 have at least this many pages.
 * `LARGE_PDF_E2E_PROXY_BYTE_BUDGET`
 *                                 optional, hard cap on aggregate
 *                                 bytes the Express
 *                                 `/api/takeoff/sheets/:id/pdf` proxy
 *                                 may serve to the worker (default
 *                                 0 — healthy operation routes 100 %
 *                                 of byte traffic through the signed
 *                                 GCS URL).
 *
 * ─── Fixture path ────────────────────────────────────────────────────
 * Canonical fixture: `gs://smartmanage-e2e-fixtures/takeoff/civil-25gb-planset.pdf`
 *   • Source: a real 1,200-sheet civil planset (DOT highway widening,
 *     stamped 2024) that we re-saved through pdftk with the embedded
 *     georeference rasters left intact. The source file is ~24.8 GB;
 *     after a `pdftk … cat output uncompress` round-trip the e2e
 *     fixture lands at 24.97 GB.
 *   • Recreate from a real planset:
 *       1. Take any large planset whose first page is rasterized
 *          (most civil sets are — the page-count test depends on
 *          pdfjs being able to parse the trailer, not on the page
 *          itself rendering quickly).
 *       2. `pdftk in.pdf cat output uncompress.pdf uncompress` then
 *          `gsutil cp uncompress.pdf gs://<bucket>/takeoff/<name>.pdf`.
 *       3. Set the env vars above to point at the new object.
 *   • Lifecycle: keep the fixture in a regional bucket co-located
 *     with the runner. Cross-region range requests during the spec
 *     would inflate the page-count budget far beyond 5 s.
 *
 * ─── How to run locally ──────────────────────────────────────────────
 *   RUN_LARGE_PDF_E2E=1 \
 *   LARGE_PDF_E2E_BUCKET=smartmanage-e2e-fixtures \
 *   LARGE_PDF_E2E_OBJECT=takeoff/civil-25gb-planset.pdf \
 *   npx playwright test e2e/takeoff-large-pdf.spec.ts --project=chromium
 *
 *   The runner needs Application Default Credentials with read access
 *   to the bucket so the dev server's `objectStorageClient` can sign
 *   URLs and download ranges on behalf of the test session.
 */

const RUN_LARGE_PDF_E2E = process.env.RUN_LARGE_PDF_E2E === "1";
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// `test.skip` at the describe level is the cleanest way to keep the
// spec invisible to CI's default `npx playwright test` invocation
// while still letting an operator opt in via the env gate above.
test.describe(RUN_LARGE_PDF_E2E ? "Task #2446 — 25 GB PDF e2e" : "Task #2446 — 25 GB PDF e2e (skipped: RUN_LARGE_PDF_E2E!=1)", () => {
  test.skip(
    !RUN_LARGE_PDF_E2E,
    "RUN_LARGE_PDF_E2E is not set — this spec talks to a real ~25 GB GCS fixture and is opt-in.",
  );

  const bucket = process.env.LARGE_PDF_E2E_BUCKET ?? "";
  const objectName = process.env.LARGE_PDF_E2E_OBJECT ?? "";
  const fileName =
    process.env.LARGE_PDF_E2E_FILE_NAME ||
    (objectName ? objectName.split("/").pop() || "" : "");
  const pageCountBudgetMs = Number(
    process.env.LARGE_PDF_E2E_PAGE_COUNT_MS ?? 5000,
  );
  const flipSheetCount = Math.max(
    2,
    Number(process.env.LARGE_PDF_E2E_FLIP_SHEETS ?? 10),
  );
  // 1-based page number per the task description ("render page 1 +
  // page 250 via range requests"). Internally we use 0-based sheet
  // indices (`sheetIndex`) — so convert at the boundary.
  const highPageNumber = Math.max(
    2,
    Number(process.env.LARGE_PDF_E2E_HIGH_PAGE ?? 250),
  );
  const proxyByteBudget = Number(
    process.env.LARGE_PDF_E2E_PROXY_BYTE_BUDGET ?? 0,
  );

  // The "this is opt-in but you asked for it" path needs both env vars.
  // Fail loudly rather than silently no-op against a placeholder bid.
  test.beforeAll(() => {
    if (!RUN_LARGE_PDF_E2E) return;
    if (!bucket || !objectName) {
      throw new Error(
        "RUN_LARGE_PDF_E2E=1 but LARGE_PDF_E2E_BUCKET / LARGE_PDF_E2E_OBJECT are missing. See spec header for the canonical fixture path.",
      );
    }
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      throw new Error(
        `Fixture file name "${fileName}" must end in .pdf so the server triggers the page-count code path.`,
      );
    }
  });

  test("page-count <5s, signed URL works, worker uses direct GCS range, cache stays under budget across 10-sheet flip", async ({
    page,
  }) => {
    // Beefy timeout — the 10-sheet flip sequence each waits for the
    // worker to satisfy its first range read against a real 25 GB
    // file. The individual perf assertions are still tight; the outer
    // timeout just prevents Playwright from killing the run if the
    // fixture bucket is momentarily slow.
    test.setTimeout(10 * 60_000);

    await installCsrf(page);
    const loginRes = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
      data: { role: "ADMIN" },
    });
    expect(loginRes.status()).toBe(200);

    // ── (a) Page-count must return in <5 s ──────────────────────────
    // The plan creation route is the public entry point that calls
    // `getPdfPageCountFromGcs`. We measure end-to-end (HTTP round
    // trip + range reads) because that's what the user actually
    // experiences when they upload a planset. Anything slower means
    // either the range path regressed or the file is being buffered.
    const fileUrl = `https://storage.googleapis.com/${bucket}/${objectName}`;

    const suffix = Date.now();
    const bidRes = await authedRequest(page, "POST", `${BASE_URL}/api/bids`, {
      data: {
        name: `PW Large PDF ${suffix}`,
        clientName: "PW Large PDF Fixture",
        bidAmount: "1000000",
      },
    });
    expect(bidRes.status()).toBe(201);
    const bid = (await bidRes.json()) as { id: string; code: string };

    const planStart = Date.now();
    const planRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/bids/${bid.id}/takeoff/plans`,
      { data: { fileUrl, fileName }, timeout: pageCountBudgetMs + 30_000 },
    );
    const planElapsed = Date.now() - planStart;
    expect(planRes.status(), await planRes.text()).toBe(201);
    const planBody = (await planRes.json()) as {
      sheets: Array<{ id: string; sheetIndex: number; sheetName: string | null }>;
      pageCount: number;
    };

    expect(
      planElapsed,
      `page-count round-trip ${planElapsed}ms exceeded ${pageCountBudgetMs}ms budget — range-only opener may have regressed to full-buffer fallback`,
    ).toBeLessThan(pageCountBudgetMs);
    expect(
      planBody.pageCount,
      "page-count returned 1 — server likely failed to open the fixture and silently defaulted",
    ).toBeGreaterThan(1);
    expect(planBody.sheets.length).toBe(planBody.pageCount);

    // Fixture must have enough pages to cover the flip sequence AND
    // the deep-page assertion ("render page 1 + page 250 via range
    // requests" from the original task description). Without this
    // guard the high-page step would silently no-op against a
    // shorter fixture.
    expect(
      planBody.sheets.length,
      `fixture has only ${planBody.sheets.length} sheets but the spec needs at least max(${flipSheetCount}, ${highPageNumber})`,
    ).toBeGreaterThanOrEqual(Math.max(flipSheetCount, highPageNumber));

    const flipSheets = planBody.sheets.slice(0, flipSheetCount);
    // The deep-page sheet that proves range access works far inside
    // the file. Indexed by `sheetIndex` so we don't depend on array
    // ordering surviving any future server-side sort change.
    const highPageIndex = highPageNumber - 1;
    const highPageSheet =
      planBody.sheets.find((s) => s.sheetIndex === highPageIndex) ??
      planBody.sheets[highPageIndex];
    expect(
      highPageSheet,
      `could not find a sheet at sheetIndex=${highPageIndex} (page ${highPageNumber})`,
    ).toBeTruthy();
    // Compose the working set: every flip-sequence sheet plus the
    // deep page. Dedup in case the high page already lives in the
    // first N. Order matters — `sheets[0]` is what the workspace
    // auto-selects on mount.
    const workingSheets = [
      ...flipSheets,
      ...(flipSheets.some((s) => s.id === highPageSheet.id)
        ? []
        : [highPageSheet]),
    ];
    const sheets = workingSheets;

    // ── (b) /pdf-url returns a working signed URL ───────────────────
    // GET — `authedRequest` only handles mutating verbs, and reading
    // /pdf-url doesn't need a CSRF token; the session cookie set by
    // /api/dev/test-login is what /pdf-url's `requireAuth` middleware
    // actually checks.
    const signedRes = await page.request.get(
      `${BASE_URL}/api/takeoff/sheets/${sheets[0].id}/pdf-url`,
    );
    expect(signedRes.status()).toBe(200);
    const signedBody = (await signedRes.json()) as {
      url: string;
      size: number | null;
      contentType: string;
    };
    expect(signedBody.url).toMatch(/^https:\/\/storage\.googleapis\.com\//);
    expect(signedBody.contentType).toMatch(/pdf/i);
    // Sanity-check the signed URL is actually fetchable (HEAD) without
    // session credentials — proves the signature itself works.
    const headRes = await page.request.fetch(signedBody.url, {
      method: "HEAD",
    });
    expect(headRes.status(), `signed URL HEAD failed: ${headRes.status()}`).toBeLessThan(400);

    // ── (c) Worker fetches PDF directly from GCS, not from /pdf ─────
    // Record every request *and response* during the flip sequence so
    // we can assert two things in tandem:
    //   1. The worker actually issued range requests against GCS
    //      directly (proves the signed-URL path is alive).
    //   2. The Express proxy (`/api/takeoff/sheets/:id/pdf`) served
    //      essentially zero bytes for the fixture — under healthy
    //      operation the worker resolves `/pdf-url` first and never
    //      hits `/pdf` at all. A few-byte tolerance via
    //      `LARGE_PDF_E2E_PROXY_BYTE_BUDGET` (default 0) prevents a
    //      tiny preview thumbnail elsewhere in the page from
    //      flapping the assertion while still catching any
    //      regression that re-routes worker byte traffic through
    //      Node.
    interface ProxyHit {
      url: string;
      method: string;
      rangeHeader: string | undefined;
      status: number;
      responseBytes: number;
    }
    const proxyHits: ProxyHit[] = [];
    // Pending proxy hits, keyed by URL but stored as a *queue* so
    // multiple concurrent requests to the exact same `/pdf` URL get
    // their responses correlated 1-to-1 (FIFO) rather than the
    // second request silently overwriting the first's pending entry.
    // Real-world driver: pdfjs may issue overlapping range reads
    // when the user pans quickly, and worker preflight + actual
    // fetch can occasionally produce identical request URLs.
    const pendingProxyByUrl = new Map<string, ProxyHit[]>();
    let directGcsRequestCount = 0;
    let directGcsRangeRequestCount = 0;

    const objectBasename = objectName.split("/").pop() || objectName;

    const onRequest = (req: Request) => {
      const url = req.url();
      if (/\/api\/takeoff\/sheets\/[^/]+\/pdf(?:\?|$)/.test(url)) {
        const hit: ProxyHit = {
          url,
          method: req.method(),
          rangeHeader: req.headers().range,
          status: 0,
          responseBytes: 0,
        };
        proxyHits.push(hit);
        const queue = pendingProxyByUrl.get(url) ?? [];
        queue.push(hit);
        pendingProxyByUrl.set(url, queue);
      } else if (
        url.startsWith("https://storage.googleapis.com/") &&
        (url.includes(encodeURIComponent(objectBasename)) ||
          url.includes(objectName))
      ) {
        directGcsRequestCount++;
        if (req.headers().range) directGcsRangeRequestCount++;
      }
    };
    page.on("request", onRequest);

    // Body-size measurement for the proxy hits. We prefer
    // `Content-Length` (cheap, always present on /pdf since it's a
    // ranged file response) and fall back to `body().length` if the
    // header is absent. A failed response counts as zero bytes (the
    // proxy returned an error envelope, not the file).
    // Track every in-flight body-read so we can drain them after the
    // settle wait below — without this the byte tally could miss a
    // late-arriving response whose `body()` was still resolving when
    // we tore down the listeners.
    const inFlightBodyReads: Promise<void>[] = [];
    const onResponse = (res: import("@playwright/test").Response) => {
      const url = res.url();
      const queue = pendingProxyByUrl.get(url);
      if (!queue || queue.length === 0) return;
      const hit = queue.shift()!;
      if (queue.length === 0) pendingProxyByUrl.delete(url);
      hit.status = res.status();
      const cl = Number(res.headers()["content-length"] ?? "");
      if (Number.isFinite(cl) && cl > 0) {
        hit.responseBytes = cl;
        return;
      }
      inFlightBodyReads.push(
        (async () => {
          try {
            const body = await res.body();
            hit.responseBytes = body.byteLength;
          } catch {
            /* response body unavailable (e.g. redirect) — leave at 0 */
          }
        })(),
      );
    };
    page.on("response", onResponse);

    // Prime the workspace with the first sheet picked + every flip-
    // candidate sheet open as a tab. Mirrors the perf spec's session-
    // storage trick because the workspace doesn't auto-pick on mount.
    await page.addInitScript(
      ({ bidId, ids }: { bidId: string; ids: string[] }) => {
        try {
          window.sessionStorage.setItem(`takeoff-sheet-${bidId}`, ids[0]);
          window.sessionStorage.setItem(
            `takeoff-sheet-${bidId}-open-tabs`,
            JSON.stringify(ids),
          );
        } catch {
          /* sessionStorage unavailable — noop */
        }
      },
      { bidId: bid.id, ids: sheets.map((s) => s.id) },
    );

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 60_000,
    });

    // Wait for the default tile cache to be exposed (the dev-build
    // hook in `use-pdf-tile-renderer` sets it once mounted).
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              !!(window as unknown as { __takeoffDefaultTileCache?: unknown })
                .__takeoffDefaultTileCache,
          ),
        {
          timeout: 30_000,
          message:
            "window.__takeoffDefaultTileCache was never exposed — dev-build hook may have been removed",
        },
      )
      .toBe(true);

    // Wait for at least one direct-from-GCS request before flipping
    // (proves the worker is talking to GCS, not the proxy, on first
    // paint).
    await expect
      .poll(() => directGcsRequestCount, {
        timeout: 60_000,
        message:
          "worker never issued a direct GCS request for the fixture — pdfjs may be falling back to the Express proxy",
      })
      .toBeGreaterThan(0);

    // ── (d) Cache stays under device-aware budget across 10 flips ───
    // Read the budget once up-front; it's set from
    // `computeDeviceAwareTileBudget()` and never changes mid-session.
    const budget = await page.evaluate(
      () =>
        (
          window as unknown as {
            __takeoffDefaultTileCache?: { stats: () => { budget: number } };
          }
        ).__takeoffDefaultTileCache!.stats().budget,
    );
    expect(budget).toBeGreaterThan(0);

    // Snapshot the direct-GCS range counter so the deep-page step
    // below can assert it grew specifically because of page 250 (not
    // just from the first-paint reads of page 1).
    const rangeCountBeforeDeepPage = directGcsRangeRequestCount;

    let peakBytes = 0;
    const visitedSheetIds = new Set<string>();
    for (let i = 1; i < sheets.length; i++) {
      const tab = page.getByTestId(`tab-sheet-${sheets[i].id}`);
      await expect(tab).toBeVisible();
      await tab.click();
      visitedSheetIds.add(sheets[i].id);
      // Give the worker time to enqueue and partially satisfy tile
      // requests for the new sheet. We don't wait for "fully painted"
      // because the budget assertion only cares about the steady-
      // state high-water mark, not visual completeness.
      await page.waitForTimeout(750);

      const stats = await page.evaluate(
        () =>
          (
            window as unknown as {
              __takeoffDefaultTileCache?: {
                stats: () => {
                  size: number;
                  bytes: number;
                  budget: number;
                  evictions: number;
                };
              };
            }
          ).__takeoffDefaultTileCache!.stats(),
      );
      if (stats.bytes > peakBytes) peakBytes = stats.bytes;
      expect(
        stats.bytes,
        `tile cache bytes ${stats.bytes} exceeded device-aware budget ${stats.budget} after flipping to sheet ${i} — eviction may be lagging or budget logic regressed`,
      ).toBeLessThanOrEqual(stats.budget);
    }

    // ── Deep-page (page 250) range read ─────────────────────────────
    // Long-range access is the part of the 25 GB story the unit
    // tests can't cover: rendering page 250 forces pdfjs to issue
    // range requests for object offsets buried deep inside the file
    // (typically gigabytes in). If the worker were silently
    // streaming the whole file via the proxy, this step would
    // either OOM Node or take forever. Instead we expect a couple
    // of *new* GCS range hits and the cache to still respect the
    // budget afterwards.
    expect(
      visitedSheetIds.has(highPageSheet.id),
      `deep-page sheet ${highPageSheet.id} (page ${highPageNumber}) was not visited during the flip sequence — workingSheets ordering bug`,
    ).toBe(true);

    // Re-click the deep-page tab to force a fresh paint after the
    // flip sequence (the worker may have evicted its tiles by now)
    // and explicitly wait for new direct-GCS range traffic before
    // sampling cache stats.
    const deepTab = page.getByTestId(`tab-sheet-${highPageSheet.id}`);
    await expect(deepTab).toBeVisible();
    await deepTab.click();
    await expect
      .poll(() => directGcsRangeRequestCount, {
        timeout: 60_000,
        message: `no new direct-GCS range requests fired for page ${highPageNumber} — long-range access path may be broken`,
      })
      .toBeGreaterThan(rangeCountBeforeDeepPage);

    const deepStats = await page.evaluate(
      () =>
        (
          window as unknown as {
            __takeoffDefaultTileCache?: {
              stats: () => { bytes: number; budget: number };
            };
          }
        ).__takeoffDefaultTileCache!.stats(),
    );
    if (deepStats.bytes > peakBytes) peakBytes = deepStats.bytes;
    expect(
      deepStats.bytes,
      `tile cache bytes ${deepStats.bytes} exceeded budget ${deepStats.budget} after rendering page ${highPageNumber}`,
    ).toBeLessThanOrEqual(deepStats.budget);

    // Wait briefly for any in-flight proxy responses to settle so the
    // byte tally below is complete. We deliberately keep the request
    // and response listeners attached *during* this wait so any late-
    // firing responses still get correlated and counted; tearing the
    // listeners off before the settle would silently undercount.
    await page.waitForTimeout(500);
    // Drain any body-read promises that were still in flight when the
    // settle window ended so their byteLength assignments land before
    // the byte aggregation runs.
    await Promise.all(inFlightBodyReads);
    page.off("request", onRequest);
    page.off("response", onResponse);

    // Sanity-check: every recorded request should now have a paired
    // response. A non-empty pending map means we'd be aggregating
    // bytes against a partial picture.
    const pendingRemaining = Array.from(pendingProxyByUrl.entries()).flatMap(
      ([url, queue]) => queue.map((h) => `  pending: ${h.method} ${url}`),
    );
    expect(
      pendingRemaining,
      `proxy hits without a paired response after settle window — byte tally would be incomplete:\n${pendingRemaining.join("\n")}`,
    ).toEqual([]);

    // ── Network shape assertions ────────────────────────────────────
    // The worker must have issued range requests directly against
    // GCS (a 25 GB file streamed through Express would saturate Node
    // memory). The Express proxy (/api/takeoff/sheets/:id/pdf) must
    // serve at-or-near zero bytes — under healthy operation the
    // worker resolves `/pdf-url` first and never hits `/pdf` at all.
    expect(
      directGcsRangeRequestCount,
      `worker issued 0 range requests against GCS directly — pdfjs may be downloading the entire fixture in one shot`,
    ).toBeGreaterThan(0);

    // Hard guard against the worst regression: a Range-less GET to
    // the proxy would stream the entire 25 GB through Node.
    const fullDocumentProxyHits = proxyHits.filter(
      (h) => h.method === "GET" && !h.rangeHeader,
    );
    expect(
      fullDocumentProxyHits,
      `Express proxy received Range-less GET(s) for the fixture — would stream 25 GB through Node:\n${fullDocumentProxyHits
        .map((h) => `  ${h.method} ${h.url}`)
        .join("\n")}`,
    ).toEqual([]);

    // Aggregate-byte guard. Default budget is 0 — a healthy session
    // routes 100 % of byte traffic through the signed GCS URL and
    // the proxy is never touched for the fixture. An operator can
    // raise `LARGE_PDF_E2E_PROXY_BYTE_BUDGET` if their environment
    // legitimately produces a small thumbnail hit somewhere outside
    // the worker, but the budget should always stay well below 1 MB
    // — anything larger means the worker is proxying byte traffic.
    const totalProxyBytes = proxyHits.reduce(
      (sum, h) => sum + (h.responseBytes || 0),
      0,
    );
    expect(
      totalProxyBytes,
      `Express proxy served ${totalProxyBytes} bytes of fixture data (budget: ${proxyByteBudget}). The worker should be talking to GCS directly via /pdf-url; any non-trivial proxy traffic means a regression has re-routed worker bytes through Node.\nProxy hits:\n${proxyHits
        .map(
          (h) =>
            `  ${h.method} ${h.url} → status=${h.status} bytes=${h.responseBytes} range=${h.rangeHeader ?? "(none)"}`,
        )
        .join("\n")}`,
    ).toBeLessThanOrEqual(proxyByteBudget);

    // Diagnostic log so an operator running this opt-in spec sees
    // the headline numbers without having to dig through the trace.
    console.log(
      `[task-2446] page-count ${planElapsed}ms / pages=${planBody.pageCount} / direct-GCS-range=${directGcsRangeRequestCount} / proxy-hits=${proxyHits.length} / peak-cache=${peakBytes}B / budget=${budget}B`,
    );
  });
});
