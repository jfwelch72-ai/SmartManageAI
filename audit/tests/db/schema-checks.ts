import type { AuditCheck } from '../../types';
import { createCheck } from '../../utils/base';

const DIRECT_ORG_TABLES = [
  'projects',
  'bids',
  'tasks',
  'crews',
  'equipment',
  'organization_documents',
  'conversations',
];

const FK_TO_PARENT: Record<string, string> = {
  'project_id': 'projects',
  'bid_id': 'bids',
  'estimate_id': 'estimates',
  'conversation_id': 'conversations',
  'user_id': 'users',
  'organization_id': 'organizations',
};

const INDIRECT_ORG_TABLES: Record<string, string[]> = {
  'estimates': ['project_id', 'bid_id'],
  'time_entries': ['project_id'],
  'change_orders': ['project_id'],
  'receipts': ['project_id'],
  'media': ['project_id'],
  'plan_documents': ['project_id'],
  'estimate_line_items': ['estimate_id'],
  'ai_tasks': ['organization_id', 'project_id'],
  'messages': ['conversation_id'],
  'time_clock_shifts': ['project_id'],
  'notifications': ['user_id'],
  'audit_log': ['user_id'],
};

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

    const allColumns = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableColumns = new Map<string, Set<string>>();
    for (const row of allColumns.rows as any[]) {
      if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, new Set());
      tableColumns.get(row.table_name)!.add(row.column_name);
    }

    for (const table of DIRECT_ORG_TABLES) {
      const hasOrgColumn = tablesWithOrgId.has(table);
      const tableExists = tableColumns.has(table);
      checks.push(createCheck(
        `schema-org-column-${table}`,
        `Table ${table} has organization scoping column`,
        'database',
        !tableExists ? 'warn' : hasOrgColumn ? 'pass' : 'warn',
        {
          message: !tableExists
            ? `Table ${table} does not exist in database`
            : hasOrgColumn 
              ? 'Table has direct organization scoping column' 
              : 'Table may be missing organization scoping - verify if needed',
        }
      ));
    }

    for (const [table, parentCols] of Object.entries(INDIRECT_ORG_TABLES)) {
      const hasOrgColumn = tablesWithOrgId.has(table);
      const cols = tableColumns.get(table);
      const tableExists = cols !== undefined;

      if (!tableExists) {
        checks.push(createCheck(
          `schema-org-column-${table}`,
          `Table ${table} has organization scoping`,
          'database',
          'warn',
          { message: `Table ${table} does not exist in database` }
        ));
        continue;
      }

      if (hasOrgColumn) {
        checks.push(createCheck(
          `schema-org-column-${table}`,
          `Table ${table} has organization scoping`,
          'database',
          'pass',
          { message: 'Table has direct organization scoping column' }
        ));
        continue;
      }

      const presentFKs = parentCols.filter(c => cols!.has(c));
      const isOrgScoped = (tbl: string, visited = new Set<string>()): boolean => {
        if (visited.has(tbl)) return false;
        visited.add(tbl);
        if (tbl === 'organizations' || tbl === 'users') return true;
        if (tablesWithOrgId.has(tbl) || DIRECT_ORG_TABLES.includes(tbl)) return true;
        const indirectFKs = INDIRECT_ORG_TABLES[tbl];
        if (!indirectFKs) return false;
        return indirectFKs.some(fk => {
          const parent = FK_TO_PARENT[fk];
          return parent ? isOrgScoped(parent, visited) : false;
        });
      };

      const verifiedFKs = presentFKs.filter(fkCol => {
        const parentTable = FK_TO_PARENT[fkCol];
        if (!parentTable) return false;
        return isOrgScoped(parentTable);
      });

      const isScoped = verifiedFKs.length > 0;
      checks.push(createCheck(
        `schema-org-column-${table}`,
        `Table ${table} has organization scoping`,
        'database',
        isScoped ? 'pass' : 'warn',
        {
          message: isScoped
            ? `Indirectly scoped via ${verifiedFKs.join(', ')} → ${verifiedFKs.map(f => FK_TO_PARENT[f]).join(', ')} (verified org-scoped parent)`
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

    const allMultiTenantTables = [...DIRECT_ORG_TABLES, ...Object.keys(INDIRECT_ORG_TABLES)];

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
      
      if (allMultiTenantTables.includes(row.table_name)) {
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
