import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_TEST_FILE = path.resolve(__dirname, "../../.env.test");

if (existsSync(ENV_TEST_FILE)) {
  const contents = readFileSync(ENV_TEST_FILE, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const existing = process.env[key];
    if (existing === undefined) {
      process.env[key] = value;
      continue;
    }
    if (key === "DATABASE_URL") {
      let existingLooksLikeTest = false;
      try {
        const u = new URL(existing);
        const dbName = (u.pathname || "").replace(/^\//, "").toLowerCase();
        existingLooksLikeTest =
          dbName.includes("test") ||
          (u.hostname || "").toLowerCase().includes("test");
      } catch {
        existingLooksLikeTest = false;
      }
      if (!existingLooksLikeTest) {
        process.env[key] = value;
      }
    }
  }
}
