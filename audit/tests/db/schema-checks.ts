import type { AuditCheck } from '../../types';
import { createCheck } from '../../utils/base';

const MULTI_TENANT_TABLES = [
  'projects',
  'bids',
  'estimates',
  'tasks',
  'timecards',
  'time_entries',
  'invoices',
  'vendors',
  'contacts',
  'messages',
  'media',
  'notes',
  'change_orders',
  'takeoffs',
  'crews',
  'equipment',
  'receipts',
  'plan_documents',
  'organization_documents',
  'estimate_line_items',
  'bid_attachments',
  'ai_tasks',
  'conversations',
  'notifications',
  'audit_log',
];

const ORG_COLUMN_NAMES = ['organization_id', 'gc_organization_id', 'tenant_id'];

export async function runSchemaChecks(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  
  try {
    const { db } = await import('../../../server/db');
    const { sql } = await import('drizzle-orm');

    const result = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND column_name IN ('organization_id', 'gc_organization_id', 'tenant_id')
      ORDER BY table_name
    `);

    const tablesWithOrgId = new Set(result.rows.map((r: any) => r.table_name));

    for (const table of MULTI_TENANT_TABLES) {
      const hasOrgColumn = tablesWithOrgId.has(table);
      checks.push(createCheck(
        `schema-org-column-${table}`,
        `Table ${table} has organization scoping column`,
        'database',
        hasOrgColumn ? 'pass' : 'warn',
        {
          message: hasOrgColumn 
            ? 'Table has organization scoping column' 
            : 'Table may be missing organization scoping - verify if needed',
        }
      ));
    }

    const fkResult = await db.execute(sql`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      ORDER BY tc.table_name
    `);

    checks.push(createCheck(
      'schema-fk-consistency',
      'Foreign keys are properly defined',
      'database',
      fkResult.rows.length > 0 ? 'pass' : 'warn',
      {
        message: `Found ${fkResult.rows.length} foreign key constraints`,
      }
    ));

    const uniqueIndexResult = await db.execute(sql`
      SELECT
        t.relname as table_name,
        i.relname as index_name,
        array_agg(a.attname ORDER BY x.n) as columns
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE t.relkind = 'r'
      AND n.nspname = 'public'
      AND ix.indisunique
      AND NOT ix.indisprimary
      GROUP BY t.relname, i.relname
      ORDER BY t.relname
    `);

    const problematicIndexes: string[] = [];
    for (const row of uniqueIndexResult.rows as any[]) {
      const cols = row.columns;
      if (!cols || !Array.isArray(cols)) continue;
      
      if (MULTI_TENANT_TABLES.includes(row.table_name)) {
        const hasOrgInIndex = cols.some((c: string) => 
          ORG_COLUMN_NAMES.includes(c)
        );
        if (!hasOrgInIndex && cols.length > 0 && !cols.includes('id')) {
          problematicIndexes.push(`${row.table_name}.${row.index_name}`);
        }
      }
    }

    checks.push(createCheck(
      'schema-unique-index-org-scope',
      'Unique indexes include organization scoping where appropriate',
      'database',
      problematicIndexes.length === 0 ? 'pass' : 'warn',
      {
        message: problematicIndexes.length === 0
          ? 'All multi-tenant unique indexes properly scoped'
          : `Potential cross-org collision in indexes: ${problematicIndexes.join(', ')}`,
        details: problematicIndexes.length > 0 
          ? 'These unique indexes may allow cross-org collision' 
          : undefined,
      }
    ));

  } catch (error) {
    checks.push(createCheck(
      'schema-check-error',
      'Schema checks execution',
      'database',
      'fail',
      {
        message: error instanceof Error ? error.message : String(error),
      }
    ));
  }

  return checks;
}
