import { db } from "./db";
import { users } from "@shared/schema";
import { hashPassword } from "./auth";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  // Check if users already exist
  const existingUsers = await db.select().from(users).limit(1);

  if (existingUsers.length > 0) {
    console.log("✅ Users already exist, skipping seed");
    return;
  }

  // Create demo users
  const adminPasswordHash = await hashPassword("admin123");
  const demoPasswordHash = await hashPassword("password123");
  
  await db.insert(users).values([
    {
      firstName: "Admin",
      lastName: "User",
      email: "admin@tfrllc.com",
      role: "ADMIN",
      isActive: true,
      passwordHash: adminPasswordHash,
    },
    {
      firstName: "Sarah",
      lastName: "Williams",
      email: "sarah@tfrconst.com",
      role: "MANAGER",
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    {
      firstName: "Jake",
      lastName: "Brown",
      email: "jake@tfrconstructionohio.com",
      role: "SUPERINTENDENT",
      isActive: true,
      passwordHash: demoPasswordHash,
    },
  ]);

  console.log("✅ Demo users created:");
  console.log("   1. admin@tfrllc.com / admin123 (ADMIN)");
  console.log("   2. sarah@tfrconst.com / password123 (MANAGER)");
  console.log("   3. jake@tfrconstructionohio.com / password123 (SUPERINTENDENT)");
  console.log("   Please change these passwords in production!");
}

seed()
  .then(() => {
    console.log("🎉 Seeding complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  });
