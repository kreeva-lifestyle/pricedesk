# PriceDesk API Documentation

**Base URL:** `https://fcmesdnagvrdmjzzuwue.supabase.co`

PriceDesk uses Supabase as its backend. All API calls go directly to the Supabase REST API (PostgREST). Authentication uses the Supabase anon key + app-level user sessions.

---

## Authentication

All requests require the Supabase anon key in headers:

```
apikey: YOUR_SUPABASE_ANON_KEY
Authorization: Bearer YOUR_SUPABASE_ANON_KEY
Content-Type: application/json
```

App-level authentication is managed through the `pd_users` key in the `app_data` table (email + SHA-256 password hash).

---

## Tables

| Table | Purpose |
|-------|---------|
| `pd_skus_v2` | Individual SKU rows (primary SKU storage) |
| `app_data` | Key-value config store (brands, thresholds, commissions, etc.) |
| `pd_sync` | Realtime sync notifications (lightweight) |
| `pd_backups` | Daily automated backups (7-day rolling) |

---

## SKU Operations

### List All SKUs

```http
GET /rest/v1/pd_skus_v2?select=*&order=updated_at.desc
```

**Pagination** (Supabase returns max 1000 per request):
```http
GET /rest/v1/pd_skus_v2?select=*&offset=0&limit=1000
GET /rest/v1/pd_skus_v2?select=*&offset=1000&limit=1000
```

**Filter active only:**
```http
GET /rest/v1/pd_skus_v2?select=*&archived=eq.false
```

**Filter archived only:**
```http
GET /rest/v1/pd_skus_v2?select=*&archived=eq.true
```

**Filter by category:**
```http
GET /rest/v1/pd_skus_v2?select=*&category=eq.Kurta%20Sets
```

**Filter by brand:**
```http
GET /rest/v1/pd_skus_v2?select=*&brand_id=eq.b1234567890
```

**Search by SKU code:**
```http
GET /rest/v1/pd_skus_v2?select=*&sku=ilike.*NKB71*
```

**Response:**
```json
[
  {
    "id": "s1741772585001",
    "sku": "NKB71-XS",
    "style_id": "40455542",
    "brand_id": "b1709123456",
    "category": "Kurta Sets",
    "level": "Level 2",
    "cost": 1100,
    "markup": 51,
    "discount": 50,
    "ignore_threshold": false,
    "archived": false,
    "tags": ["TANUKA"],
    "note": "",
    "updated_at": "2026-04-07T10:30:00.000Z"
  }
]
```

---

### Get Single SKU

```http
GET /rest/v1/pd_skus_v2?id=eq.s1741772585001&select=*
```

---

### Create SKU

```http
POST /rest/v1/pd_skus_v2
Content-Type: application/json
Prefer: return=representation

{
  "id": "s1741772585001",
  "sku": "NKB71-XS",
  "style_id": "40455542",
  "brand_id": "b1709123456",
  "category": "Kurta Sets",
  "level": "Level 2",
  "cost": 1100,
  "markup": 51,
  "discount": 50,
  "ignore_threshold": false,
  "archived": false,
  "tags": [],
  "note": ""
}
```

**ID Format:** `'s' + Date.now()` (e.g., `s1741772585001`)

---

### Update SKU

```http
PATCH /rest/v1/pd_skus_v2?id=eq.s1741772585001
Content-Type: application/json
Prefer: return=representation

{
  "cost": 1200,
  "markup": 55,
  "discount": 45,
  "updated_at": "2026-04-07T12:00:00.000Z"
}
```

Only include fields you want to change. Omitted fields remain unchanged.

---

### Delete SKU

```http
DELETE /rest/v1/pd_skus_v2?id=eq.s1741772585001
```

**This is atomic** — deleting one SKU does not affect any other SKU.

---

### Archive SKU (Out of Stock)

```http
PATCH /rest/v1/pd_skus_v2?id=eq.s1741772585001
Content-Type: application/json

{
  "archived": true,
  "tags": ["STOCK OUT"],
  "updated_at": "2026-04-07T12:00:00.000Z"
}
```

### Unarchive SKU (Back in Stock)

```http
PATCH /rest/v1/pd_skus_v2?id=eq.s1741772585001
Content-Type: application/json

{
  "archived": false,
  "tags": [],
  "updated_at": "2026-04-07T12:00:00.000Z"
}
```

---

### Bulk Upsert SKUs

```http
POST /rest/v1/pd_skus_v2
Content-Type: application/json
Prefer: resolution=merge-duplicates

[
  {"id": "s001", "sku": "SKU-A", "cost": 1000, "markup": 50, ...},
  {"id": "s002", "sku": "SKU-B", "cost": 1500, "markup": 60, ...},
  ...
]
```

Use `Prefer: resolution=merge-duplicates` header for upsert behavior (insert if new, update if exists).

---

## Config Operations (app_data table)

All configuration is stored as key-value pairs in the `app_data` table.

### Read Config

```http
GET /rest/v1/app_data?key=eq.pd_brands&select=value
```

**Available keys:**

| Key | Data Type | Description |
|-----|-----------|-------------|
| `pd_brands` | JSON Array | Brand definitions |
| `pd_users` | JSON Array | User accounts |
| `pd_thresholds` | JSON Object | Profit thresholds per category (e.g., `{"Kurta Sets": 450}`) |
| `pd_categories` | JSON Array | Category names |
| `pd_levels` | JSON Array | Price level names (e.g., `["Level 1", "Level 2"]`) |
| `pd_cat_levels` | JSON Object | Category → Level mapping |
| `pd_comm_myntra` | JSON Object | Myntra commission matrix (category × slab) |
| `pd_comm_ajio_ppmp` | JSON Object | Ajio PPMP commission rates |
| `pd_comm_ajio_cc` | JSON Object | Ajio CC commission rates |
| `pd_comm_amazon` | JSON Object | Amazon referral fees by category |
| `pd_logistics` | JSON Object | GT charges, reverse fees, logistics settings |
| `pd_wireframe` | JSON Object | Wireframe calculation engine formulas |
| `pd_alert_settings` | JSON Object | Alert email configuration |
| `pd_email_config` | JSON Object | EmailJS credentials |
| `pd_audit_log` | JSON Array | Activity audit trail (max 500 entries) |
| `pd_sku_history` | JSON Object | SKU price change history (keyed by SKU ID) |
| `pd_sessions` | JSON Object | Active user sessions |

---

### Write Config

```http
POST /rest/v1/app_data
Content-Type: application/json
Prefer: resolution=merge-duplicates

{
  "key": "pd_thresholds",
  "value": {"Kurta Sets": 450, "Sarees": 500, "Co-Ords": 450},
  "updated_at": "2026-04-07T12:00:00.000Z"
}
```

---

## Data Models

### Brand

```json
{
  "id": "b1709123456",
  "name": "Fusionic",
  "marketplace": "Myntra",
  "model": "myntra",
  "commOverride": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `'b' + timestamp` |
| `name` | string | Brand display name |
| `marketplace` | string | Display name of marketplace |
| `model` | string | Calculation model: `myntra`, `ajio-ppmp`, `ajio-cc`, `amazon` |
| `commOverride` | number\|null | Override commission % (required for Ajio) |

---

### SKU (pd_skus_v2)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | text | Yes (PK) | Format: `'s' + timestamp` |
| `sku` | text | Yes | SKU code (e.g., `NKB71-XS`) |
| `style_id` | text | No | Myntra Style ID (e.g., `40455542`) |
| `brand_id` | text | Yes | References brand ID |
| `category` | text | Yes | Product category |
| `level` | text | No | Price level (default: `Level 2`) |
| `cost` | numeric | Yes | Cost price in INR |
| `markup` | numeric | Yes | Markup percentage |
| `discount` | numeric | No | Discount percentage (default: 0) |
| `ignore_threshold` | boolean | No | Exclude from threshold alerts |
| `archived` | boolean | No | Out of stock flag |
| `tags` | jsonb | No | Array of tag strings |
| `note` | text | No | Internal notes |
| `updated_at` | timestamptz | Auto | Last modification time |

---

### User

```json
{
  "id": "u0",
  "name": "Manthan Dhameliya",
  "email": "manthan@example.com",
  "role": "admin",
  "passwordHash": "sha256:a1b2c3d4..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `'u' + timestamp` (admin is `u0`) |
| `name` | string | Display name |
| `email` | string | Login email (case-insensitive) |
| `role` | string | `admin` or `viewer` |
| `passwordHash` | string | SHA-256 hash with `sha256:` prefix |

**Default password:** `pricedesk123` (upgraded to SHA-256 on first login)

---

### Threshold

```json
{
  "Kurta Sets": 450,
  "Sarees": 500,
  "Co-Ords": 450,
  "Ethnic Dresses": 600,
  "Lehenga Choli": 400
}
```

Key = category name, Value = minimum net profit in INR.

---

### Commission (Myntra)

```json
{
  "Kurta Sets": [0, 0, 18.88, 18.88, 18.88],
  "Sarees": [0, 0, 15.5, 15.5, 15.5]
}
```

Array indices correspond to price slabs. The commission % is applied based on seller price.

---

## Calculation Engine

The profit calculation is performed client-side using the wireframe engine. The core formula varies by marketplace:

### Myntra

```
MRP = round(Cost × (1 + Markup/100))
Customer Paid = MRP - (MRP × Discount/100)
GT Charge = lookup(Level, Customer Paid price band)
Seller Price = Customer Paid - GT Charge
GST Rate = Customer Paid >= 2500 ? 18% : 5%
Commission % = lookup(Category, Seller Price slab)
Commission Amount = Seller Price × Commission%
Payout = Seller Price - Commission - GST - TCS - TDS - Reverse Fee - Collection Fee - PG Fee
Net Profit = Payout - Cost
If Delivered = Net Profit + Reverse Fee
Gross Settlement = Seller Price - Commission(AMT) - (Collection Fee × 1.18)
```

### Ajio PPMP / CC

```
MRP = round(Cost + Cost × Markup/100) × 3
MRP Rounded = round(MRP / 100) × 100
Gross Sale = MRP Rounded - (MRP Rounded × Discount/100)
GST Rate = Gross Sale > 2500 ? 18% : 5%
GST Value = Gross Sale × GST Rate / (1 + GST Rate)
Commission Amount = Gross Sale × Commission% (brand override)
Purchase Price = MRP Rounded - Discount - GST Value - Commission
Invoice Value = Purchase Price + (Purchase Price × GST B2B Rate)
Marketing Contribution = Invoice Value × 3%
Payout = Invoice Value - Logistics - Marketing (PPMP)
Payout = Invoice Value - Marketing (CC, no logistics)
Net Profit = Payout - Cost
```

### Amazon

```
MRP = round(Cost × (1 + Markup/100))
SP = round(MRP × 3 / 100) × 100
GST Rate = SP >= 2500 ? 18% : 5%
Commission = SP × Commission% (category-based or brand override)
Fees = Commission + FBA Fee + Closing Fee
GST on Fees = Fees × GST Rate
Payout = SP - Fees - GST on Fees
Net Profit = Payout - Cost
```

---

## Realtime Sync

PriceDesk uses two realtime channels:

1. **`pd_sync`** — For non-SKU config changes (brands, thresholds, commissions). Lightweight key+timestamp notifications.
2. **`pd_skus_v2`** — Direct per-row realtime for SKU INSERT/UPDATE/DELETE events.

### Subscribe to SKU changes:

```javascript
const channel = supabase.channel('sku-changes')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'pd_skus_v2' },
    (payload) => {
      console.log('Change:', payload.eventType, payload.new || payload.old);
    }
  )
  .subscribe();
```

---

## Aggregate Queries

### Count SKUs by status

```http
GET /rest/v1/pd_skus_v2?select=archived,count&archived=eq.false
```

### Count by category

```http
GET /rest/v1/pd_skus_v2?select=category,count&archived=eq.false&order=category
```

### Get all archived (out of stock)

```http
GET /rest/v1/pd_skus_v2?select=*&archived=eq.true&order=updated_at.desc
```

### Get SKUs with specific tag

```http
GET /rest/v1/pd_skus_v2?select=*&tags=cs.["STOCK OUT"]
```

---

## Rate Limits & Best Practices

| Limit | Value |
|-------|-------|
| Supabase Free Tier | 500 MB database, 2 GB bandwidth/month |
| Max rows per request | 1000 (use pagination for larger datasets) |
| Max request size | ~2 MB payload |
| Realtime connections | 200 concurrent (free tier) |
| API rate limit | ~100 requests/second |

### Best Practices

1. **Paginate large queries** — Use `offset` and `limit` for datasets > 1000 rows
2. **Use PATCH for updates** — Only send changed fields, not the entire object
3. **Batch upserts** — Use `Prefer: resolution=merge-duplicates` for bulk operations
4. **Leverage Realtime** — Subscribe to `pd_skus_v2` changes instead of polling
5. **Always include `updated_at`** — Set to `new Date().toISOString()` on every write

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 201 | Created |
| 204 | Deleted (no content) |
| 400 | Bad request (invalid data) |
| 401 | Unauthorized (missing/invalid API key) |
| 404 | Row not found |
| 409 | Conflict (duplicate key) |
| 422 | Validation error |
| 500 | Server error |
| 504 | Gateway timeout (DB overloaded) |
| 522 | Connection timeout |

---

## Example: Complete SKU Lifecycle

```bash
# 1. Create a new SKU
curl -X POST "$BASE_URL/rest/v1/pd_skus_v2" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "id": "s1712500000001",
    "sku": "TEST-SKU-1",
    "brand_id": "b1709123456",
    "category": "Kurta Sets",
    "cost": 1000,
    "markup": 50,
    "discount": 40
  }'

# 2. Update the discount
curl -X PATCH "$BASE_URL/rest/v1/pd_skus_v2?id=eq.s1712500000001" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"discount": 45, "updated_at": "2026-04-07T12:00:00Z"}'

# 3. Archive it (out of stock)
curl -X PATCH "$BASE_URL/rest/v1/pd_skus_v2?id=eq.s1712500000001" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"archived": true, "tags": ["STOCK OUT"]}'

# 4. Delete it permanently
curl -X DELETE "$BASE_URL/rest/v1/pd_skus_v2?id=eq.s1712500000001" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY"
```

---

## Database Schema (SQL)

```sql
-- Core config store
CREATE TABLE IF NOT EXISTS app_data (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Per-row SKU storage (eliminates multi-user conflicts)
CREATE TABLE IF NOT EXISTS pd_skus_v2 (
  id                TEXT PRIMARY KEY,
  sku               TEXT,
  style_id          TEXT,
  brand_id          TEXT,
  category          TEXT,
  level             TEXT DEFAULT 'Level 2',
  cost              NUMERIC DEFAULT 0,
  markup            NUMERIC DEFAULT 0,
  discount          NUMERIC DEFAULT 0,
  ignore_threshold  BOOLEAN DEFAULT false,
  archived          BOOLEAN DEFAULT false,
  tags              JSONB DEFAULT '[]'::jsonb,
  note              TEXT DEFAULT '',
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Lightweight realtime notifications
CREATE TABLE IF NOT EXISTS pd_sync (
  key         TEXT PRIMARY KEY,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Daily backups (7-day rolling)
CREATE TABLE IF NOT EXISTS pd_backups (
  backup_date TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies (allow all for anon key)
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_skus_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE pd_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON app_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_skus" ON pd_skus_v2 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sync" ON pd_sync FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_backups" ON pd_backups FOR ALL USING (true) WITH CHECK (true);

-- Realtime: SKU table + sync notifications
ALTER PUBLICATION supabase_realtime ADD TABLE pd_skus_v2;
ALTER PUBLICATION supabase_realtime ADD TABLE pd_sync;
```
