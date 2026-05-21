# Feature D: Vendor Pricing Sync

> **Status: IMPLEMENTED** — This doc was the original planning spec. Feature shipped; see live code at `server/vendorPricebookRoutes.ts`, `server/ai/vendorPriceListExtractor.ts`, and `client/src/pages/vendor-pricing.tsx` + `client/src/pages/pricebook-import.tsx`.
>
> **Implementation notes vs. spec:**
> - AI-assisted column mapping in `server/ai/vendorPriceListExtractor.ts` uses `routedGeneralChatCompletion` (Anthropic Claude primary). Original spec assumed OpenAI-only.
> - Pricebook import flow: CSV/XLSX upload → AI column-map suggestion → user confirmation → import to `vendorPricebooks` / `vendorPriceItems` tables.
> - Material price index (`/material-price-index`) provides trend analysis.
> - Vendor pricing syncs into bid estimates and material calculators via UI dropdowns.

---

## Overview
Allows vendors/suppliers to upload pricing catalogs (materials, rentals, trucking) and sync them into calculators, bids, and estimates. The system maps vendor items to **trade-specific** material categories and SOW items, maintaining price history for trend analysis.

## Trade-Specific Material Categories

### Material Mapping by Trade Type

| Trade Type | Primary Material Categories | Common Vendors | Pricing Units |
|------------|---------------------------|----------------|---------------|
| **ROOFING** | Shingles, Underlayment, Flashings, Fasteners, Ventilation, Gutters | ABC Supply, Beacon, SRS | SQ, LF, EA, Bundle |
| **ELECTRICAL** | Wire, Conduit, Panels, Devices, Fixtures, Boxes | Graybar, WESCO, CED | LF, EA, Box, Spool |
| **PLUMBING** | Pipe, Fittings, Fixtures, Valves, Water Heaters | Ferguson, HD Supply, Hajoca | LF, EA, Each |
| **HVAC** | Ductwork, Equipment, Refrigerant, Controls, Insulation | Johnstone, Carrier, Trane | LF, EA, TON, LB |
| **CONCRETE** | Ready-mix, Rebar, Forms, Accessories, Sealers | Local batch plants, rebar suppliers | CY, LF, TON, GAL |
| **CARPENTRY** | Lumber, Sheathing, Fasteners, Hardware, Trim | 84 Lumber, BMC, local yards | BF, LF, EA, Sheet |
| **MASONRY** | Block, Brick, Mortar, Rebar, Lintels | Boral, General Shale | EA, Bag, LF |
| **PAINTING** | Paint, Primer, Caulk, Prep materials | Sherwin-Williams, PPG, Benjamin Moore | GAL, Tube, EA |
| **FLOORING** | Flooring materials, Underlayment, Adhesives, Transitions | Shaw, Mohawk, Armstrong | SF, SY, GAL, LF |
| **DRYWALL** | Drywall sheets, Compound, Tape, Corner bead | USG, National Gypsum | Sheet, Bucket, Roll |
| **GENERAL_CONTRACTOR** | All categories (coordinates multiple trades) | All vendor types | All units |

## Technical Architecture

### Pricebook Import Flow
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Upload CSV/    │────▶│  Parse &         │────▶│  AI-Assisted    │
│  XLSX           │     │  Validate        │     │  Mapping        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Available in   │◀────│  Store Prices    │◀────│  User Review    │
│  Calculators    │     │  + History       │     │  & Confirm      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Integration Points
1. **CRM Vendors**: Links to `crm_organisations` (type: VENDOR, SUPPLIER, RENTAL_VENDOR)
2. **Calculators**: Feeds into `organization_calculators` and `master_calculators`
3. **Bid Cost Builder**: Auto-populates material costs in estimates
4. **Master UOM**: Uses `units_of_measure` for standardization
5. **SOW Items**: Maps to `organization_sow_items` for scope-based pricing

## API Endpoints

### POST /api/vendors/pricebook/upload
Uploads a vendor pricebook for processing.

**Request (multipart/form-data):**
```typescript
{
  vendorId: string;               // CRM organisation ID
  fileType: 'CSV' | 'XLSX';
  effectiveDate?: string;         // When prices take effect
  expirationDate?: string;        // When prices expire
  tradeType?: string;             // Filter to specific trade
  mappingPreset?: string;         // Previously saved mapping
}
// + file in multipart
```

**Response:**
```typescript
{
  success: boolean;
  pricebookId: string;
  status: 'PROCESSING';
  itemCount: number;
  previewUrl: string;             // Link to mapping preview
}
```

### GET /api/vendors/pricebook/:id/preview
Returns parsed items for mapping review.

**Response:**
```typescript
{
  pricebookId: string;
  vendorName: string;
  itemCount: number;
  columns: string[];
  sampleRows: Array<Record<string, any>>;
  suggestedMappings: {
    codeColumn: string;
    descriptionColumn: string;
    priceColumn: string;
    unitColumn: string;
  };
  items: Array<{
    rowNumber: number;
    vendorCode: string;
    vendorDescription: string;
    vendorUnit: string;
    vendorPrice: number;
    suggestedCategory?: string;
    suggestedSowItem?: {
      id: string;
      name: string;
      code: string;
    };
    suggestedUom?: {
      code: string;
      name: string;
    };
    mappingConfidence: number;
  }>;
}
```

### POST /api/vendors/pricebook/:id/confirm
Confirms mappings and imports pricebook.

**Request:**
```typescript
{
  mappings: Array<{
    rowNumber: number;
    categoryOverride?: string;
    sowItemIdOverride?: string;
    uomOverride?: string;
    priceOverride?: number;
    skipItem?: boolean;
  }>;
  saveAsPreset?: string;           // Save mapping for future uploads
}
```

### GET /api/vendors/pricebook/items
Retrieves imported pricebook items with filtering.

**Query Params:**
- `vendorId`: Filter by vendor
- `category`: Filter by material category
- `tradeType`: Filter by trade
- `search`: Text search
- `active`: Only active prices

**Response:**
```typescript
{
  items: Array<{
    id: string;
    vendorId: string;
    vendorName: string;
    vendorCode: string;
    description: string;
    category: string;
    unit: string;
    unitPrice: number;
    effectiveDate: string;
    expirationDate?: string;
    priceHistory: Array<{
      price: number;
      date: string;
    }>;
    linkedSowItem?: {
      id: string;
      name: string;
      code: string;
    };
    linkedCalculator?: {
      id: string;
      name: string;
    };
  }>;
  totalCount: number;
}
```

### GET /api/vendors/pricebook/compare
Compares prices across vendors.

**Query Params:**
- `category`: Material category
- `itemDescription`: Search term
- `vendorIds`: Comma-separated vendor IDs (optional)

**Response:**
```typescript
{
  searchTerm: string;
  results: Array<{
    category: string;
    description: string;
    vendorPrices: Array<{
      vendorId: string;
      vendorName: string;
      vendorCode: string;
      unitPrice: number;
      unit: string;
      lastUpdated: string;
    }>;
    lowestPrice: {
      vendorId: string;
      vendorName: string;
      price: number;
    };
    averagePrice: number;
  }>;
}
```

## Database Schema

### New Table: vendor_pricebooks
```sql
CREATE TABLE vendor_pricebooks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  vendor_id VARCHAR NOT NULL REFERENCES crm_organisations(id),
  file_key VARCHAR NOT NULL,
  file_name VARCHAR,
  file_type VARCHAR NOT NULL,
  effective_date DATE,
  expiration_date DATE,
  trade_type VARCHAR,
  mapping_preset_json JSONB,
  status VARCHAR NOT NULL DEFAULT 'PENDING',  -- PENDING, PROCESSING, ACTIVE, EXPIRED, SUPERSEDED
  item_count INTEGER DEFAULT 0,
  imported_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  uploaded_by_user_id VARCHAR REFERENCES users(id)
);
```

### New Table: vendor_pricebook_items
```sql
CREATE TABLE vendor_pricebook_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  pricebook_id VARCHAR NOT NULL REFERENCES vendor_pricebooks(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id),
  vendor_id VARCHAR NOT NULL REFERENCES crm_organisations(id),
  vendor_code VARCHAR NOT NULL,
  vendor_description TEXT NOT NULL,
  vendor_unit VARCHAR,
  category VARCHAR NOT NULL,
  unit VARCHAR NOT NULL,                        -- Standardized to master_uom
  unit_price DECIMAL(12, 4) NOT NULL,
  markup_percent DECIMAL(5, 2) DEFAULT 0,
  sow_item_id VARCHAR REFERENCES organization_sow_items(id),
  calculator_key VARCHAR,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE,
  expiration_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pricebook_items_vendor ON vendor_pricebook_items(vendor_id);
CREATE INDEX idx_pricebook_items_category ON vendor_pricebook_items(category);
CREATE INDEX idx_pricebook_items_active ON vendor_pricebook_items(is_active, effective_date);
```

### New Table: vendor_price_history
```sql
CREATE TABLE vendor_price_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  pricebook_item_id VARCHAR NOT NULL REFERENCES vendor_pricebook_items(id) ON DELETE CASCADE,
  old_price DECIMAL(12, 4),
  new_price DECIMAL(12, 4) NOT NULL,
  change_percent DECIMAL(6, 2),
  effective_date DATE NOT NULL,
  recorded_at TIMESTAMP DEFAULT NOW()
);
```

## Frontend Components

### Pricebook Tab (CRM Vendor Detail)
- **Upload Section**: Drag-and-drop file upload
- **Active Pricebooks**: List of imported pricebooks with status
- **Items Table**: Searchable/filterable list of priced items
- **Price History Chart**: Trend visualization for selected items

### Mapping Preview Modal
- **Column Mapping**: Assign CSV/XLSX columns to fields
- **Item Preview**: Table showing parsed items with suggested mappings
- **Bulk Actions**: Accept all suggestions, skip rows, override values
- **Trade Filter**: Show only trade-relevant categories

### Price Comparison View
- **Search Bar**: Find items across all vendors
- **Comparison Table**: Side-by-side vendor pricing
- **Best Price Highlight**: Visual indicator for lowest price
- **Quick Add to Estimate**: One-click add to current bid/estimate

### Calculator Integration
- **"Use Vendor Pricing" Toggle**: In calculator inputs
- **Vendor Selector**: Choose which vendor's prices to use
- **Auto-Update Option**: Recalculate when prices change

## RBAC Access
- **ADMIN, MANAGER**: Full access (upload, map, edit, delete)
- **ESTIMATOR**: Upload, view, use in estimates
- **SUPERINTENDENT, OFFICE_MANAGER**: View only
- **FOREMAN, FIELD_WORKER**: No access

## Price Change Notifications
When new pricebook supersedes old:
1. Calculate price deltas
2. Flag significant changes (> 5%)
3. Notify estimators of affected bids/estimates
4. Log in audit trail

## Development Phases
1. **Phase 1**: Database schema + upload/parse endpoints
2. **Phase 2**: AI-assisted mapping + preview UI
3. **Phase 3**: Calculator integration + comparison view
4. **Phase 4**: Price history + change notifications
