import { db } from "./db";
import { users } from "@shared/schema";
import { hashPassword } from "./auth";
import { eq } from "drizzle-orm";

async function fixPasswords() {
  console.log("🔧 Fixing password hashes...");

  // Fix admin user
  const adminHash = await hashPassword("admin123");
  await db.update(users)
    .set({ passwordHash: adminHash })
    .where(eq(users.email, "admin@tfrllc.com"));
  console.log("✅ Updated admin@tfrllc.com");

  // Fix jake
  const jakeHash = await hashPassword("password123");
  await db.update(users)
    .set({ passwordHash: jakeHash })
    .where(eq(users.email, "jake@tfrconstructionohio.com"));
  console.log("✅ Updated jake@tfrconstructionohio.com");

  // Fix sarah
  const sarahHash = await hashPassword("password123");
  await db.update(users)
    .set({ passwordHash: sarahHash })
    .where(eq(users.email, "sarah@tfrconst.com"));
  console.log("✅ Updated sarah@tfrconst.com");

  console.log("🎉 All passwords fixed!");
}

fixPasswords()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Failed:", error);
    process.exit(1);
  });
