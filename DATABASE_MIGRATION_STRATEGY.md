# TFR Construction Platform - Database Migration Strategy

**Last Updated**: November 19, 2025  
**Database**: PostgreSQL (Neon-hosted)  
**ORM**: Drizzle ORM  
**Strategy**: Schema-first with `db:push`

---

## Overview

The TFR Construction Platform uses Drizzle ORM with a **schema-first, push-based** migration strategy. This approach prioritizes rapid development and iteration while maintaining database consistency.

## Current State

- **23 Database Tables** fully defined in `shared/schema.ts`
- **1 Manual Migration File**: `server/migrations/001_backfill_token_version.sql`
- **Primary Strategy**: `npm run db:push` for schema synchronization
- **Database**: Neon PostgreSQL (cloud-hosted)

## Why db:push vs Manual Migrations?

### Our Approach: `db:push`

**Advantages**:
1. **Speed**: Instantly sync schema changes to database
2. **Simplicity**: No migration file management during active development
3. **Flexibility**: Easy to iterate on schema design
4. **Perfect for Small Teams**: Fewer moving parts, less coordination overhead

**When to Use**:
- ✅ Development and staging environments
- ✅ Adding new tables or columns
- ✅ Changing column types (non-destructive)
- ✅ Adding/removing indexes
- ✅ Initial schema setup

### Traditional Migrations (`drizzle-kit generate` + `migrate`)

**Advantages**:
1. **Version Control**: Explicit migration history
2. **Rollback Support**: Can revert to previous schema versions
3. **Audit Trail**: Clear record of all schema changes
4. **Production Safety**: Review changes before applying

**When Required**:
- ⚠️ Production deployments with existing data
- ⚠️ Complex data transformations
- ⚠️ Column renames that require data preservation
- ⚠️ Multi-step migrations with dependencies

---

## Our Workflow

### Development Cycle

```bash
# 1. Modify schema in shared/schema.ts
# 2. Sync to database
npm run db:push

# If conflicts detected:
npm run db:push --force  # CAREFUL: May drop columns with data
```

### Schema Change Example

```typescript
// Add new fields to projects table in shared/schema.ts
export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  // ... existing fields ...
  
  // NEW FIELDS (Nov 19, 2025)
  budget: decimal("budget", { precision: 12, scale: 2 }),
  contractAmount: decimal("contract_amount", { precision: 12, scale: 2 }),
  estimatedCompletionDate: timestamp("estimated_completion_date"),
});
```

Then run:
```bash
npm run db:push
```

Drizzle automatically generates and executes:
```sql
ALTER TABLE "projects" ADD COLUMN "budget" numeric(12, 2);
ALTER TABLE "projects" ADD COLUMN "contract_amount" numeric(12, 2);
ALTER TABLE "projects" ADD COLUMN "estimated_completion_date" timestamp;
```

---

## Manual Migrations (When Needed)

### Existing Manual Migration

**File**: `server/migrations/001_backfill_token_version.sql`

**Purpose**: Backfill `tokenVersion` column for existing users

**Why Manual?**:
- Requires data transformation (setting existing users to `tokenVersion = 0`)
- Cannot be automated by schema diff alone
- Needs to run ONCE after schema change

### When to Create Manual Migrations

1. **Data Backfilling**
   - Populating new required columns with calculated values
   - Example: Setting default values for non-null columns

2. **Complex Transformations**
   - Splitting one column into multiple
   - Combining multiple columns into one
   - JSON data structure changes

3. **Column Renames**
   - Drizzle sees rename as DROP + ADD (data loss!)
   - Manual migration preserves data:
     ```sql
     ALTER TABLE "projects" RENAME COLUMN "old_name" TO "new_name";
     ```

4. **Custom Constraints**
   - Check constraints
   - Custom triggers
   - Stored procedures

### How to Create Manual Migration

```bash
# 1. Create migration file manually
touch server/migrations/002_your_migration_name.sql

# 2. Write SQL
cat > server/migrations/002_your_migration_name.sql << 'EOF'
-- Description: What this migration does
-- Date: YYYY-MM-DD
-- Author: Your Name

BEGIN;

-- Your SQL here
UPDATE projects SET budget = contract_amount WHERE budget IS NULL;

COMMIT;
EOF

# 3. Run manually via psql or database tool
# (No automatic migration runner configured)
```

---

## Production Deployment Strategy

### Recommended Approach

1. **Development**: Use `db:push` freely

2. **Staging**: 
   - Test `db:push` on staging environment
   - Verify no data loss
   - Check application functionality

3. **Production**:
   - **Option A (Current)**: `db:push --force` directly
     - Fast, but risky if misaligned
     - Requires database backup first
   
   - **Option B (Recommended)**: Generate explicit migrations
     ```bash
     npm run db:generate  # Creates migration SQL
     npm run db:migrate   # Applies migrations
     ```
     - Safer for production
     - Allows review before apply
     - Creates audit trail

### Migration Safety Checklist

Before running migrations in production:

- [ ] Database backup created
- [ ] Schema changes tested in staging
- [ ] Data transformation scripts tested
- [ ] Rollback plan documented
- [ ] Downtime window scheduled (if needed)
- [ ] Application code updated to match new schema
- [ ] Integration tests passing

---

## Current Schema (23 Tables)

1. `users` - User accounts and authentication
2. `projects` - Active construction projects
3. `bids` - Bid tracking and proposals
4. `estimates` - Project cost estimates
5. `procurement_items` - Material and equipment tracking
6. `plan_documents` - Blueprint and plan storage
7. `time_entries` - Employee time tracking
8. `tm_daily_sheets` - T&M daily reporting
9. `receipts` - Expense receipts
10. `project_notes` - Field notes and updates
11. `scope_items` - Scope of work items
12. `media` - Photos and videos
13. `change_orders` - Change order management
14. `calendar_events` - Events and time-off
15. `notifications` - In-app notifications
16. `file_permissions` - File access control
17. `audit_log` - Compliance audit trail
18. `billing_events` - Financial milestones
19. `time_clock_shifts` - GPS time-clock data
20. `time_clock_events` - Clock in/out events
21. `ai_settings` - AI system configuration
22. `ai_runs` - AI analysis execution history
23. `ai_tasks` - AI-generated tasks

---

## Schema Changes Log (Nov 19, 2025)

### Added to `projects` table:
- `budget` (decimal) - Project budget for profitability tracking
- `contractAmount` (decimal) - Awarded contract value
- `estimatedCompletionDate` (timestamp) - Project completion target

**Reason**: CFO dashboard profitability engine requires budget comparison

**Applied via**: `npm run db:push`

**Migration**: Automatic (new columns, nullable)

---

## Best Practices

### DO ✅

1. **Always Backup** before production schema changes
2. **Test in Staging** first
3. **Document** significant schema changes in this file
4. **Add Indexes** for frequently queried columns
5. **Use Nullable** for new columns on existing tables
6. **Validate** application works after schema change

### DON'T ❌

1. **Never** change primary key column types (`serial` ↔ `varchar`)
2. **Never** use `db:push --force` in production without backup
3. **Never** rename columns via `db:push` (use manual migration)
4. **Never** drop tables via `db:push` without data export
5. **Never** change column types that lose precision (e.g., `text` → `varchar(50)`)

---

## Future Improvements

### Short-Term
- [ ] Add `npm run db:migrate` workflow
- [ ] Create production migration SOP
- [ ] Set up automated database backups

### Long-Term
- [ ] Implement blue-green deployments for zero-downtime schema changes
- [ ] Add database migration testing in CI/CD
- [ ] Create schema documentation generator

---

## Troubleshooting

### "Migration conflict detected"

**Cause**: Local schema doesn't match database

**Solution**:
```bash
# Option 1: Accept database schema (discard local changes)
npm run db:pull

# Option 2: Force local schema (DANGEROUS - may drop data)
npm run db:push --force
```

### "Column does not exist"

**Cause**: Application code references column not yet in database

**Solution**:
1. Check `shared/schema.ts` has the column defined
2. Run `npm run db:push`
3. Restart application server

### "Cannot drop column, data exists"

**Cause**: Trying to remove column with data

**Solution**:
1. Export data if needed
2. Remove column from schema
3. Run `npm run db:push --force` (after backup!)

---

## Emergency Rollback Procedure

If a migration breaks production:

1. **Stop Application** (prevent further writes)
2. **Restore Database Backup**
   ```bash
   # Via Neon dashboard or pg_restore
   ```
3. **Revert Code** to previous version
4. **Restart Application**
5. **Investigate** migration issue in staging

---

## Contact & Resources

**Database Admin**: TFR Construction Tech Lead  
**Backup Location**: Neon automated backups (7-day retention)  
**Drizzle Docs**: https://orm.drizzle.team/docs/overview  
**Neon Docs**: https://neon.tech/docs/introduction

---

**Document Owner**: Replit Agent  
**Review Frequency**: After major schema changes  
**Last Schema Change**: November 19, 2025 (added project budget fields)
