# SmartManageAI Bid Line-Item Grammar (Hard-Coded)

## Naming format (recommended)
`{Action} {System/Component} - {Qualifier1} {Qualifier2} ({UOM})`

Examples:
- Furnish & Install Slab on Grade - 4 in 4000 PSI broom (SF)
- Install Domestic Water Piping - PEX 1 in insulated (LF)
- Remove & Dispose Gypsum Board (Walls) - 1/2 in (SF)
- Furnish & Install Conduit - EMT 3/4 in (LF)

## Controlled vocab tables

### Actions (enumeration)
Furnish & Install, Install, Remove & Dispose, Demo & Dispose, Repair, Patch, Seal, Prime & Paint, Test, Commission, Excavate & Backfill

### UOM (enumeration)
EA, LF, SF, SY, CY, TON, GAL, BAG, LS, AC, DAY, SQ, BF, LB

### Qualifier rules
- Always include size (diameter, thickness, gauge) where applicable.
- Always include performance class where applicable (PSI, rating_hr, pressure_class).
- Always include finish where applicable (finish_type, sheen).
- Optional location tag: `@ {Level}/{Room}/{Area}` (does not change pricing logic; improves organization).

## Mapping rules (how onboarding picks correct line items)
1. User selects Trade -> default scopes load.
2. For each selected scope:
   - enforce required parameters based on UOM + scope parameters.
   - choose quantity formula ID (from formulas.json)
   - choose labor formula ID (L_LABOR_QTY_OVER_RATE by default)
   - map to material families (materials.json)

## GC logic
If role == GC:
- trade access = ALL trades
- scope access = ALL scopes
- onboarding asks: "What scopes do you self-perform?" (multi-select)
- remaining scopes default to subcontracted (still visible for bid & schedule)

