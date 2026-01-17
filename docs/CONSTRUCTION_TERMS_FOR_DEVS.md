# Construction Terms for Developers

**A glossary for programmers, QA testers, and engineers with zero construction background.**

---

## How to Use This Glossary

Each term includes:
- **Plain English** - What it means in simple terms
- **Why It Exists in Software** - How we use it in the app
- **What Breaks If Wrong** - The consequences of getting it wrong

---

## Core Terms

### Estimate

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A detailed breakdown of what a job will cost: labor hours, material quantities, equipment needs, and markup. Contractors create estimates to set their bid price. | The estimate becomes the budget baseline when a project starts. We compare actual costs against it. Also used for line item pricing. | No baseline = can't track profit/loss. Wrong estimate = company loses money on the job. Table: `estimates`, `estimateLineItems` |

---

### Cost Code

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A number/code that categorizes a type of cost (like "03-Concrete" or "26-Electrical"). Standard codes come from CSI (Construction Specifications Institute). | Allows grouping costs for reporting. "How much did we spend on concrete across all jobs?" Also ensures consistency across projects. | Costs can't be categorized. Reports meaningless. Hard to compare jobs. Related: `tradeType` enum, scope items |

---

### Production Rate

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| How much work a crew can complete per hour. Example: "4 workers install 100 SF of concrete per hour = 25 SF/man-hour." | Historical production rates improve future estimates. If we know our concrete crew averages 25 SF/man-hour, we can estimate labor accurately. | Estimates are guesses instead of data-driven. Either overbid (lose job) or underbid (lose money). |

---

### Schedule of Values (SoV)

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A breakdown of the total contract price into line items for billing. Each month, contractor shows % complete per line to request payment. | Tracks what's been billed, what's owed. Prevents overbilling. Shows progress. | Can't invoice correctly. Either bill too much (legal issues) or too little (cash flow problems). Table: SoV tables |

---

### Time & Material (T&M)

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Work billed by actual hours and materials used (plus markup), rather than a fixed price. Used for extra work not in the original contract. | T&M tickets document the extra work with customer signature. Provides legal proof of work and agreement. | No proof = can't bill. Disputes arise. Tables: `tmTickets`, `tmTicketLaborEntries`, etc. |

---

### Daily Report

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A written record of what happened on a job each day: weather, crew size, work performed, problems encountered. | Evidence for disputes, progress tracking, communication with office. AI analyzes for insights. | No documentation = no protection in disputes. Can't prove what happened. Table: `projectNotes` |

---

### Delay

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| When work can't proceed as planned. Causes: weather, GC scheduling, inspections, materials. Different parties may be responsible. | Documented delays can result in time extensions or cost recovery. Critical for claims. | Undocumented delay = contractor eats the cost. Table: `projectDelays`, `delayNotifications` |

---

### Change Order

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A formal document changing the original contract: adding/removing scope, changing price, adjusting schedule. Must be approved. | Tracks contract modifications. Prevents scope creep. Ensures payment for extra work. | Extra work done without CO = contractor not paid. Table: `changeOrders` |

---

### Punchlist

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A list of small items remaining to complete before final payment. Created during walkthrough near project end. | Tracks remaining work. Must be complete for final billing. | Job never officially closes. Final payment withheld. |

---

### Subcontractor

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A company hired by the main contractor to do specialized work (electrical, plumbing, etc.). | Tracked in CRM for quotes, payments, performance. Subcontract management for scope/budget. | Can't track costs, manage relationships, or coordinate work. Table: `crmOrganisations` (type: SUBCONTRACTOR) |

---

### General Contractor (GC)

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| The main contractor responsible for the entire project. Hires subcontractors. The "customer" for subs. | GC contacts stored in CRM. Bids often go to GCs. Delay notices sent to GC. | Don't know who to communicate with. Can't track bid sources. Table: `crmOrganisations` (type: CONTRACTOR) |

---

### Owner

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| The person/company paying for the construction (building owner, developer, government agency). | Ultimate decision maker. Some projects are direct to owner (not through GC). | Billing goes to wrong party. Communication breakdown. Table: `crmOrganisations` (type: OWNER_REP) |

---

### Crew

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| A group of workers who work together on a job. Usually has a foreman. | Assign work to crews. Track productivity per crew. Schedule crews across projects. | Can't track who did what work. Productivity unknown. Table: `crews`, `crewMembers` |

---

### Superintendent

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Field supervisor responsible for daily operations on jobsite. Manages workers, coordinates with GC, documents issues. | Key user role. Approves time, enters daily notes, manages delays. | Nobody to approve field data. Work isn't documented. Role: `SUPERINTENDENT` |

---

### Project Manager (PM)

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Office-based manager overseeing projects. Handles billing, contracts, coordination. | Creates bids/projects, manages estimates, reviews financials. | No oversight. Billing not submitted. Role: `MANAGER` |

---

### Quantity Installed

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| How much work was completed. Measured in units matching scope (SF, LF, CY, etc.). Reported daily. | Drives progress %, billing, production rates. Core of daily tracking. | Can't bill accurately. Don't know project status. Table: `dailyScopeProgress` |

---

### Budget vs Actual

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Budget = what was planned/estimated. Actual = what was spent. Variance = difference. | Core of job costing. Determines if project is profitable. | Don't know if making or losing money. |

---

### Committed Cost

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Money contracted to be spent (subcontracts, purchase orders) but not yet paid. | Gives true picture of remaining budget. Purchase order exists = money is committed even if not yet paid. | Think you have more budget than you do. |

---

### Equipment Utilization

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| How much equipment is being used. High utilization = equipment earning its keep. Low utilization = maybe should rent instead. | Tracks hours used, calculates cost per hour, informs rent vs buy decisions. | Own expensive equipment that sits idle. Table: `equipment` |

---

### Rent vs Buy

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| Decision: should we own this equipment or rent when needed? Depends on utilization rate. | System tracks owned equipment costs. Compare against rental prices. | Waste money owning underused equipment, or overpaying for rentals. |

---

### Closeout

| Plain English | Why It Exists in Software | What Breaks If Wrong |
|---------------|---------------------------|----------------------|
| The process of finishing a project: completing punchlist, passing final inspection, collecting final payment, archiving. | Project lifecycle status: COMPLETE → CLOSED. Triggers final reports, production rate capture. | Projects never officially close. Data not captured for future use. |

---

## Units of Measure

| Abbreviation | Meaning | Common Use |
|--------------|---------|------------|
| SF | Square Feet | Flatwork, slabs, flooring |
| LF | Linear Feet | Forms, piping, curbs |
| CY | Cubic Yards | Concrete volume, excavation |
| SY | Square Yards | Paving, flooring (alternative) |
| EA | Each | Count items (fixtures, etc.) |
| TON | Ton | Asphalt, aggregate |
| GAL | Gallon | Sealers, coatings |
| HR | Hour | Labor, equipment time |
| MH | Man-Hours | Labor hours (crew × hours) |
| LS | Lump Sum | Fixed price for scope |

---

## Project Phases

| Phase | Description | In System |
|-------|-------------|-----------|
| Bid | Pursuing the work, estimating | `bids` table, status tracking |
| Award | Won the contract | Bid status = WON |
| Planning | Setting up job before field work | Project status = PLANNING |
| Mobilization | Moving equipment/materials to site | Part of ACTIVE |
| Execution | Doing the work | Project status = ACTIVE |
| Punchlist | Final items remaining | Near COMPLETE |
| Closeout | Finishing documentation, final billing | Status = COMPLETE → CLOSED |

---

## Common Scenarios Explained

### "We're over budget on labor"
- Actual labor hours × rates > estimated labor cost
- Check: time entries vs estimate line items
- Cause: worked more hours than estimated, or higher-paid workers used

### "The GC is backcharging us"
- GC claims we caused damage or delay, deducting from payment
- Need documentation (photos, daily notes) to dispute

### "We need a change order"
- Scope changed from original contract
- Must document: what changed, additional cost, who requested
- Without CO approval, don't get paid for extra work

### "The inspector failed us"
- Inspection didn't pass, work must be corrected
- Logged as inspection with status FAILED
- Causes schedule delay

### "We're behind schedule"
- Actual progress < planned progress
- Check scope progress % vs baseline schedule
- May need to add crew or work overtime

---

## Cross-References

- [PROGRAMMER_USER_GUIDE.md](./PROGRAMMER_USER_GUIDE.md) - Development guide
- [SYSTEM_FEATURE_BIBLE.md](./SYSTEM_FEATURE_BIBLE.md) - Complete feature documentation
- [ACCOUNT_ROLES_RBAC.md](./ACCOUNT_ROLES_RBAC.md) - User roles explained
