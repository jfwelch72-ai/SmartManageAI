// Provider-agnostic exported-id tracking helpers.
//
// Mirrors the persistence shape used by both QBO and Sage Intacct:
// `integration_sync_state` rows keyed by (connectionId, entityType) whose
// `metadata` JSON holds:
//   - `exportedIds`: string[]        — local PKs that have been pushed
//   - `idMapping`:   Record<local,remote> — local PK → remote PK lookup
//   - `lastExportAt`: ISO timestamp
//
// New providers should import these helpers instead of re-implementing the
// same metadata shape, so cache invalidation, dry-run accounting, and
// idempotency stay consistent across integrations.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { integrationSyncState } from "@shared/schema";

export async function getExportedIds(
  connectionId: string,
  entityType: string,
): Promise<Set<string>> {
  const [state] = await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType),
    ));
  const meta = state?.metadata as Record<string, any> | undefined;
  return new Set(meta?.exportedIds || []);
}

export async function getIdMapping(
  connectionId: string,
  entityType: string,
): Promise<Record<string, string>> {
  const [state] = await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType),
    ));
  const meta = state?.metadata as Record<string, any> | undefined;
  return meta?.idMapping || {};
}

export async function trackExportedId(
  connectionId: string,
  organizationId: string,
  entityType: string,
  newId: string,
  remoteId?: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType),
    ));

  const meta = (existing?.metadata as Record<string, any>) || {};
  const exportedIds: string[] = meta.exportedIds || [];
  const idMapping: Record<string, string> = meta.idMapping || {};

  if (!exportedIds.includes(newId)) exportedIds.push(newId);
  if (remoteId) idMapping[newId] = remoteId;

  const updatedMeta = {
    ...meta,
    exportedIds,
    idMapping,
    lastExportAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(integrationSyncState)
      .set({ metadata: updatedMeta, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(integrationSyncState.id, existing.id));
  } else {
    await db.insert(integrationSyncState).values({
      organizationId,
      connectionId,
      entityType,
      metadata: updatedMeta,
      lastSyncAt: new Date(),
    });
  }
}
