/**
 * Seed Script: Create Full Test Company with All Users
 * 
 * Creates:
 * - RealTest Construction (main test organization with enterprise tier + all add-ons)
 * - All 10 user roles with @realtest.com emails
 * - RealTest Subcontractors (subcontractor organization for invite testing)
 * 
 * Run with: npm run seed:test-company
 */

import { db } from "../server/db";
import { 
  organizations, 
  users, 
  organizationSubscriptions,
  organizationAddOns 
} from "../shared/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "TestPass123!";

interface TestUser {
  firstName: string;
  lastName: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "OFFICE_MANAGER" | "HOURLY_EMPLOYEE" | "MAINTENANCE_MANAGER" | "VENDOR" | "HUSTLER";
  phone?: string;
}

const MAIN_ORG_USERS: TestUser[] = [
  { firstName: "Super", lastName: "Admin", email: "superadmin@realtest.com", role: "SUPER_ADMIN", phone: "555-100-0001" },
  { firstName: "Organization", lastName: "Admin", email: "admin@realtest.com", role: "ADMIN", phone: "555-100-0002" },
  { firstName: "Project", lastName: "Manager", email: "manager@realtest.com", role: "MANAGER", phone: "555-100-0003" },
  { firstName: "Site", lastName: "Superintendent", email: "super@realtest.com", role: "SUPERINTENDENT", phone: "555-100-0004" },
  { firstName: "Cost", lastName: "Estimator", email: "estimator@realtest.com", role: "ESTIMATOR", phone: "555-100-0005" },
  { firstName: "Office", lastName: "Manager", email: "office@realtest.com", role: "OFFICE_MANAGER", phone: "555-100-0006" },
  { firstName: "Field", lastName: "Worker", email: "worker@realtest.com", role: "HOURLY_EMPLOYEE", phone: "555-100-0007" },
  { firstName: "Equipment", lastName: "Manager", email: "maintenance@realtest.com", role: "MAINTENANCE_MANAGER", phone: "555-100-0008" },
  { firstName: "Vendor", lastName: "Contact", email: "vendor@realtest.com", role: "VENDOR", phone: "555-100-0009" },
  { firstName: "Business", lastName: "Owner", email: "hustler@realtest.com", role: "HUSTLER", phone: "555-100-0010" },
];

const SUB_ORG_USERS: TestUser[] = [
  { firstName: "Sub", lastName: "Admin", email: "subadmin@realtest.com", role: "ADMIN", phone: "555-200-0001" },
  { firstName: "Sub", lastName: "Estimator", email: "subestimator@realtest.com", role: "ESTIMATOR", phone: "555-200-0002" },
  { firstName: "Sub", lastName: "Foreman", email: "subforeman@realtest.com", role: "SUPERINTENDENT", phone: "555-200-0003" },
];

const ALL_ADDONS: ("ai_pm" | "ai_cfo" | "ai_email" | "website_seo" | "bid_network" | "ai_vision")[] = [
  "ai_pm",
  "ai_cfo", 
  "ai_email",
  "website_seo",
  "bid_network",
  "ai_vision"
];

async function cleanupExisting() {
  console.log("Cleaning up any existing test data...");
  
  const testEmails = [...MAIN_ORG_USERS, ...SUB_ORG_USERS].map(u => u.email);
  
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
  
  await db.delete(organizations).where(eq(organizations.slug, "realtest-construction"));
  await db.delete(organizations).where(eq(organizations.slug, "realtest-subcontractors"));
  
  console.log("Cleanup complete.");
}

async function createOrganization(
  name: string,
  slug: string,
  tradeType: "GENERAL_CONTRACTOR" | "CONCRETE" | "ELECTRICAL" | "PLUMBING" | "HVAC" | "ROOFING" | "PAINTING" | "FLOORING" | "LANDSCAPING" | "DEMOLITION" | "EXCAVATION" | "MASONRY" | "STEEL_ERECTION" | "CARPENTRY" | "DRYWALL" | "INSULATION" | "FIRE_PROTECTION" | "GLAZING" | "TILE_TERRAZZO" | "ACOUSTICAL" | "WATERPROOFING" | "PAVING" | "FENCING" | "CUSTOM",
  isSubcontractor: boolean = false
) {
  console.log(`Creating organization: ${name}...`);
  
  const [org] = await db.insert(organizations).values({
    name,
    slug,
    tradeType,
    tradeName: isSubcontractor ? "Specialty Subcontracting" : "General Construction",
    address: isSubcontractor ? "456 Sub Street" : "123 Main Street",
    city: "Construction City",
    state: "TX",
    zipCode: "75001",
    phone: isSubcontractor ? "555-200-0000" : "555-100-0000",
    email: isSubcontractor ? "info@realtest-sub.com" : "info@realtest.com",
    typicalCrewSize: isSubcontractor ? 15 : 50,
    region: "Southwest",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  
  console.log(`  Created org ID: ${org.id}`);
  return org;
}

async function createSubscription(organizationId: string, planTier: "free" | "starter" | "professional" | "enterprise") {
  console.log(`  Setting subscription to ${planTier}...`);
  
  const currentPeriodEnd = new Date();
  currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
  
  await db.insert(organizationSubscriptions).values({
    organizationId,
    planTier,
    status: "active",
    billingProvider: "manual",
    currentPeriodEnd,
  });
}

async function enableAllAddons(organizationId: string) {
  console.log("  Enabling all add-ons...");
  
  for (const addonKey of ALL_ADDONS) {
    await db.insert(organizationAddOns).values({
      organizationId,
      addonKey,
      status: "active",
    });
    console.log(`    - ${addonKey}: ACTIVE`);
  }
}

async function createUsers(orgId: string, userList: TestUser[]) {
  console.log(`  Creating ${userList.length} users...`);
  
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  
  for (const user of userList) {
    await db.insert(users).values({
      organizationId: orgId,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      passwordHash,
      isActive: true,
      walkthroughCompleted: true,
      walkthroughStep: 0,
    });
    console.log(`    - ${user.email} (${user.role})`);
  }
}

async function main() {
  console.log("========================================");
  console.log("  SmartManageAI Test Company Seeder");
  console.log("========================================\n");
  
  try {
    await cleanupExisting();
    
    console.log("\n--- Creating Main Test Organization ---");
    const mainOrg = await createOrganization(
      "RealTest Construction",
      "realtest-construction",
      "GENERAL_CONTRACTOR",
      false
    );
    
    await createSubscription(mainOrg.id, "enterprise");
    await enableAllAddons(mainOrg.id);
    await createUsers(mainOrg.id, MAIN_ORG_USERS);
    
    console.log("\n--- Creating Subcontractor Organization ---");
    const subOrg = await createOrganization(
      "RealTest Subcontractors",
      "realtest-subcontractors",
      "CONCRETE",
      true
    );
    
    await createSubscription(subOrg.id, "professional");
    await createUsers(subOrg.id, SUB_ORG_USERS);
    
    console.log("\n========================================");
    console.log("  SEED COMPLETE!");
    console.log("========================================");
    console.log("\nMain Organization: RealTest Construction");
    console.log(`  ID: ${mainOrg.id}`);
    console.log("  Plan: Enterprise (Scale) with ALL add-ons");
    console.log(`  Users: ${MAIN_ORG_USERS.length}`);
    console.log("\nSubcontractor Organization: RealTest Subcontractors");
    console.log(`  ID: ${subOrg.id}`);
    console.log("  Plan: Professional (Growth)");
    console.log(`  Users: ${SUB_ORG_USERS.length}`);
    console.log("\nDefault Password for ALL users:", DEFAULT_PASSWORD);
    console.log("\nSee TEST_COMPANY_ACCOUNTS.md for full account details.");
    
    process.exit(0);
  } catch (error) {
    console.error("\nSeed failed:", error);
    process.exit(1);
  }
}

main();
