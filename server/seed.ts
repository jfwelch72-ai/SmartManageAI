import { db } from "./db";
import { users } from "@shared/schema";
import { hashPassword } from "./auth";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  // Check if admin user already exists
  const [existingAdmin] = await db.select().from(users).where(eq(users.email, "admin@tfrllc.com")).limit(1);

  if (existingAdmin) {
    console.log("✅ Admin user already exists");
    return;
  }

  // Create admin user
  const adminPasswordHash = await hashPassword("admin123");
  
  await db.insert(users).values({
    firstName: "Admin",
    lastName: "User",
    email: "admin@tfrllc.com",
    role: "ADMIN",
    isActive: true,
    passwordHash: adminPasswordHash,
  });

  console.log("✅ Admin user created:");
  console.log("   Email: admin@tfrllc.com");
  console.log("   Password: admin123");
  console.log("   Please change this password in production!");
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
