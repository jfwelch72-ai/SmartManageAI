/**
 * Money path: Accounting integration sync (QuickBooks Online + Sage
 * Intacct sandboxes).
 *
 * SCOPE NOTE — Task #2483:
 *   Real round-trip coverage against the QBO and Sage Intacct
 *   sandboxes is explicitly scoped OUT of this task because the
 *   provider modules do not yet exist under
 *   `server/integrations/providers/{qbo,sage-intacct}`. There is no
 *   server endpoint for this spec to drive yet.
 *
 *   Wiring those providers + sandboxes is tracked by follow-up
 *   #2506. The skipped test bodies below are kept as the contract
 *   the integration team should fill in once the providers land
 *   (build invoice → POST /api/integrations/{qbo,sage}/sync → poll
 *   the sandbox → assert amount + customer + line items match).
 *
 *   Required secrets when un-skipping:
 *     QBO_SANDBOX_CLIENT_ID, QBO_SANDBOX_CLIENT_SECRET,
 *     QBO_SANDBOX_REFRESH_TOKEN, QBO_SANDBOX_REALM_ID
 *
 *     SAGE_INTACCT_SANDBOX_COMPANY_ID, SAGE_INTACCT_SANDBOX_USER_ID,
 *     SAGE_INTACCT_SANDBOX_USER_PASSWORD,
 *     SAGE_INTACCT_SANDBOX_SENDER_ID
 */
import { test } from "@playwright/test";

test.describe("Accounting sandbox sync (QBO + Sage Intacct)", () => {
  test.skip(
    true,
    "Scoped out of Task #2483 — QBO/Sage providers not yet implemented; tracked by follow-up #2506",
  );

  test("invoice round-trips against the QBO sandbox", async () => {
    // Filled in once the QBO provider lands (#2506).
  });

  test("bill round-trips against the Sage Intacct sandbox", async () => {
    // Filled in once the Sage Intacct provider lands (#2506).
  });
});
