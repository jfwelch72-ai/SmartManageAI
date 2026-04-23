# `incoming/` — staging area for DOT pay-item drops

This folder is where authoritative pay-item lists are dropped after they've
been pulled from each agency's portal/website. The agent sandbox cannot
reach most state-DOT pay-item sources directly (FHWA is fronted by Akamai
and 403s scripted clients; TxDOT/PennDOT/Caltrans/FDOT/etc. publish theirs
behind portals, JS apps, or login walls), so a human on a host with
outbound access has to fetch the file once per spec edition.

The folder is intentionally `.gitkeep`'d but otherwise empty. **Do not
commit dropped data files** — they are large and licensed by each agency.

## Workflow

1. **Pull the source file.** Use the link in the table below to download
   the agency's published pay-item list. Some agencies publish CSV/XML
   directly; others require exporting from an estimator/portal app.

2. **Normalize to CSV (or XML) and rename.** Save the file to this folder
   as `incoming/<AGENCY_CODE>.csv` (or `.xml`). The default expected CSV
   columns are `Item, Description, Unit, Section, Category` (the first
   three are required; `Section`/`Category` are optional). Per-agency
   header overrides are wired into `scripts/fetch-dot-pay-items.ts`
   (`STAGED_AGENCIES.<CODE>.csvColumnMap`) — adjust there if the agency
   ships different headers.

3. **Run the fetcher.** From the project root:

   ```bash
   tsx scripts/fetch-dot-pay-items.ts <AGENCY_CODE>     # one agency
   tsx scripts/fetch-dot-pay-items.ts                   # every registered agency
   tsx scripts/fetch-dot-pay-items.ts <CODE> --dry-run  # parse + validate only
   ```

   > **Heads up:** the no-arg run targets every registered agency, including
   > the 10 staged-drop ones. Until every agency below has a file in this
   > folder, the no-arg run will fail for any agency without a drop with the
   > "No staged drop found for &lt;CODE&gt;" message — that is expected. Pass
   > the agency code(s) explicitly to fetch only what's actually staged.

   The fetcher reads the dropped file, validates it against the
   per-agency `expectedMinItems` floor (mirrors
   `server/seedDotAgencies.ts`), and writes
   `server/data/dot/pay-items/<CODE>.json` in the seeder's expected
   shape. If the parsed count falls under the floor it refuses to write
   so a truncated drop can never silently replace a real catalog.

4. **(Optional) Push to the database.** The seeder will pick up the new
   JSON on next boot. If you also want to backfill the live database
   without restarting, run the importer's DB-push path:

   ```bash
   DATABASE_URL=... tsx scripts/import-dot-pay-items.ts \
     --agency=<CODE> --file=incoming/<CODE>.csv --push-db \
     --edition="<edition>" --title="<title>" --source="<sourceUrl>"
   ```

## Agency drop targets

| Code     | Edition | Expected ≥ | Source / portal |
|----------|---------|------------|-----------------|
| FHWA     | 2014    | 3,500      | https://highways.dot.gov/federal-lands/estimates/pay-items-fp-14 (Akamai blocks scripts; copy table from browser) |
| TXDOT    | 2014    | 3,000      | https://www.txdot.gov/business/letting-bids.html → `LCS_BIDLIST.csv` from a recent letting |
| CALTRANS | 2022    | 2,400      | https://dot.ca.gov/programs/design/ccs-standard-plans-and-standard-specifications → `std-pay-item-<year>-a11y.pdf` (PDF→CSV) |
| FDOT     | 2024    | 3,000      | https://fdotwp1.fdot.gov/BasisOfEstimatesOnline/ → `Export to Excel` |
| NYSDOT   | 2024    | 2,500      | https://www.dot.ny.gov/main/business-center/engineering/specifications/pay-item-catalog → Pay Item List → Export |
| PENNDOT  | 2020    | 2,700      | ECMS (login required) → `Item Number List.csv` |
| ODOT     | 2023    | 2,700      | https://www.transportation.ohio.gov/working/engineering/cadd-mapping/aashtoware/reference-data → `OHIO_PayItemList.csv` |
| IDOT     | 2022    | 2,400      | AASHTOWare BAMS/DSS reference data → `IL_PayItemMaster.csv` |
| GDOT     | 2021    | 2,400      | http://www.dot.ga.gov/PartnerSmart/Business/Source2Pay/Pages/PayItems.aspx → `GDOT_PayItems.xlsx` (XLSX→CSV) |
| VDOT     | 2020    | 2,400      | VDOT Construction Division SharePoint → `VDOT_PayItem.xml` (drop as `VDOT.xml`) |

The same metadata (URLs, editions, titles, expected minimums, optional
column maps) lives in `STAGED_AGENCIES` inside
`scripts/fetch-dot-pay-items.ts`. Update both this table and the manifest
when an agency publishes a new spec edition.

## Notes

- The fetcher prefers a staged drop when one exists. For FHWA, if no
  `incoming/FHWA.csv` is present it falls back to scraping the FP-14
  HTML page (which works only when run from a host that isn't blocked by
  Akamai).
- Drops are intentionally not committed. After running the fetcher,
  commit the regenerated `server/data/dot/pay-items/<CODE>.json` and
  delete the staged file.
- If an agency ships an XLSX or PDF, convert to CSV before dropping —
  the fetcher does not bundle PDF/XLSX parsers for arbitrary layouts.
