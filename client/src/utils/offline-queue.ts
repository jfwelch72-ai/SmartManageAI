import { apiRequest } from "@/lib/queryClient";

interface QueuedMeasurement {
  id: string;
  sheetId: string;
  type: string;
  points: any[];
  label?: string;
  categoryId?: string;
  timestamp: number;
}

const STORAGE_KEY = "takeoff_offline_queue";

function getQueue(): QueuedMeasurement[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedMeasurement[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function addToOfflineQueue(measurement: Omit<QueuedMeasurement, "id" | "timestamp">): void {
  const queue = getQueue();
  queue.push({
    ...measurement,
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
  });
  saveQueue(queue);
}

export function getOfflineQueueCount(): number {
  return getQueue().length;
}

export function getOfflineQueue(): QueuedMeasurement[] {
  return getQueue();
}

export function clearOfflineQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function syncOfflineQueue(
  onProgress?: (synced: number, total: number) => void
): Promise<{ synced: number; failed: number }> {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: QueuedMeasurement[] = [];

  for (const item of queue) {
    try {
      await apiRequest("POST", `/api/takeoff/sheets/${item.sheetId}/measurements`, {
        type: item.type,
        points: item.points,
        label: item.label,
        categoryId: item.categoryId,
      });
      synced++;
      onProgress?.(synced, queue.length);
    } catch {
      failed++;
      remaining.push(item);
    }
  }

  saveQueue(remaining);
  return { synced, failed };
}

export function isOnline(): boolean {
  return navigator.onLine;
}
