import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// Use HTTP driver for Replit environment (WebSockets not supported in serverless)
// Note: This driver does NOT support transactions - must handle atomicity at application level
const sql = neon(process.env.DATABASE_URL);
export const db = drizzle({ client: sql, schema });
