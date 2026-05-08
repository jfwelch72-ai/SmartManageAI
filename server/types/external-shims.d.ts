declare module "@replit/object-storage" {
  export class Client {
    constructor(opts?: unknown);
    uploadFromBytes(key: string, bytes: Buffer | Uint8Array): Promise<unknown>;
    uploadFromText(key: string, text: string): Promise<unknown>;
    downloadAsBytes(key: string): Promise<{ ok: boolean; value?: Uint8Array; error?: unknown }>;
    delete(key: string): Promise<unknown>;
    list(prefix?: string): Promise<unknown>;
  }
}

declare module "expo-sqlite" {
  export interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, ...params: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
    getAllAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
    getFirstAsync<T = unknown>(sql: string, ...params: unknown[]): Promise<T | null>;
    closeAsync(): Promise<void>;
  }
  export function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
  export function openDatabaseSync(name: string): SQLiteDatabase;
}
