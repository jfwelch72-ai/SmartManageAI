/**
 * Seed Script: Create Full Test Company with All Users
 * 
 * Creates:
 * - RealTest Construction (main test organization with enterprise tier + all add-ons)
 * - All 18 user roles with @realtest.com emails
 * - RealTest Subcontractors (subcontractor organization for invite testing)
 * 
 * Run with: npm run seed:test-company
 */

import { db } from "../server/db";
import { 
  organizations, 
  users, 
  organizationSubscriptions,
  organizationAddOns,
  masterSowItems,
  organizationSowItems,
  notifications
} from "../shared/schema";
import bcrypt from "bcrypt";
import { eq, asc, and } from "drizzle-orm";
import { seedAllNewTradeSowItems } from "../server/seedTradeExpansion";

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "TestPass123!";

interface TestUser {
  firstName: string;
  lastName: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "HUSTLER" | "MANAGER" | "SUPERINTENDENT" | "ESTIMATOR" | "FIELD_WORKER" | "VENDOR";
  phone?: string;
}

const MAIN_ORG_USERS: TestUser[] = [
  { firstName: "Super", lastName: "Admin", email: "superadmin@realtest.com", role: "SUPER_ADMIN", phone: "555-100-0001" },
  { firstName: "Organization", lastName: "Admin", email: "admin@realtest.com", role: "ADMIN", phone: "555-100-0002" },
  { firstName: "Project", lastName: "Manager", email: "manager@realtest.com", role: "MANAGER", phone: "555-100-0003" },
  { firstName: "Site", lastName: "Superintendent", email: "super@realtest.com", role: "SUPERINTENDENT", phone: "555-100-0004" },
  { firstName: "Cost", lastName: "Estimator", email: "estimator@realtest.com", role: "ESTIMATOR", phone: "555-100-0005" },
  { firstName: "Office", lastName: "Manager", email: "office@realtest.com", role: "MANAGER", phone: "555-100-0006" },
  { firstName: "Field", lastName: "Worker", email: "worker@realtest.com", role: "FIELD_WORKER", phone: "555-100-0007" },
  { firstName: "Equipment", lastName: "Manager", email: "maintenance@realtest.com", role: "FIELD_WORKER", phone: "555-100-0008" },
  { firstName: "Vendor", lastName: "Contact", email: "vendor@realtest.com", role: "VENDOR", phone: "555-100-0009" },
  { firstName: "Business", lastName: "Owner", email: "hustler@realtest.com", role: "HUSTLER", phone: "555-100-0010" },
  { firstName: "Sales", lastName: "Rep", email: "sales@realtest.com", role: "MANAGER", phone: "555-100-0011" },
  { firstName: "Marketing", lastName: "Lead", email: "marketing@realtest.com", role: "MANAGER", phone: "555-100-0012" },
  { firstName: "Safety", lastName: "Manager", email: "safety@realtest.com", role: "SUPERINTENDENT", phone: "555-100-0013" },
  { firstName: "HR", lastName: "Manager", email: "hr@realtest.com", role: "MANAGER", phone: "555-100-0014" },
  { firstName: "Equipment", lastName: "Manager", email: "equipment@realtest.com", role: "FIELD_WORKER", phone: "555-100-0015" },
  { firstName: "Project", lastName: "Engineer", email: "engineer@realtest.com", role: "ESTIMATOR", phone: "555-100-0016" },
  { firstName: "Procurement", lastName: "Manager", email: "procurement@realtest.com", role: "MANAGER", phone: "555-100-0017" },
  { firstName: "Fleet", lastName: "Dispatcher", email: "dispatcher@realtest.com", role: "SUPERINTENDENT", phone: "555-100-0018" },
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
  
  // Get existing test organizations first
  const [mainOrg] = await db.select().from(organizations).where(eq(organizations.slug, "realtest-construction"));
  const [subOrg] = await db.select().from(organizations).where(eq(organizations.slug, "realtest-subcontractors"));
  
  // Clean up organization SOW items first (before deleting orgs)
  if (mainOrg) {
    await db.delete(organizationSowItems).where(eq(organizationSowItems.organizationId, mainOrg.id));
    await db.delete(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, mainOrg.id));
    await db.delete(organizationAddOns).where(eq(organizationAddOns.organizationId, mainOrg.id));
  }
  if (subOrg) {
    await db.delete(organizationSowItems).where(eq(organizationSowItems.organizationId, subOrg.id));
    await db.delete(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, subOrg.id));
    await db.delete(organizationAddOns).where(eq(organizationAddOns.organizationId, subOrg.id));
  }
  
  // Delete test users - but first we need to nullify their references in audit_log
  // Instead of deleting users with constraints, just deactivate them and update orgs
  const testEmails = [...MAIN_ORG_USERS, ...SUB_ORG_USERS].map(u => u.email);

  // Wipe all notifications for test users (clears cross-org leakage from upserts)
  for (const email of testEmails) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      await db.delete(notifications).where(eq(notifications.userId, existing.id));
    }
  }
  
  for (const email of testEmails) {
    // Just delete the user - if it fails due to FK, we'll handle it
    try {
      await db.delete(users).where(eq(users.email, email));
    } catch (err: any) {
      // User might have FK references - skip deletion, just update instead
      console.log(`  Skipping user ${email} deletion due to references, will recreate with update`);
    }
  }
  
  // Delete organizations (if they don't have FK constraints)
  try {
    if (mainOrg) await db.delete(organizations).where(eq(organizations.id, mainOrg.id));
    if (subOrg) await db.delete(organizations).where(eq(organizations.id, subOrg.id));
  } catch (err: any) {
    console.log("  Organizations have references, will update instead of recreate");
  }
  
  console.log("Cleanup complete.");
}

async function createOrganization(
  name: string,
  slug: string,
  tradeType: string,
  isSubcontractor: boolean = false
) {
  console.log(`Creating organization: ${name}...`);
  
  // Check if org already exists (couldn't be cleaned up due to FK constraints)
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  if (existing) {
    console.log(`  Organization already exists, using existing ID: ${existing.id}`);
    return existing;
  }
  
  const orgData = {
    name,
    slug,
    tradeType: tradeType as any,
    tradeName: isSubcontractor ? "Specialty Subcontracting" : "General Construction",
    address: isSubcontractor ? "456 Sub Street" : "123 Main Street",
    city: "Construction City",
    state: "TX",
    zipCode: "75001",
    phone: isSubcontractor ? "555-200-0000" : "555-100-0000",
    email: isSubcontractor ? "info@realtest-sub.com" : "info@realtest.com",
    typicalCrewSize: isSubcontractor ? 15 : 50,
    region: "Southwest",
    onboardingStatus: "COMPLETED" as const,
    isActive: true,
  };
  
  const [org] = await db.insert(organizations).values(orgData).returning();
  
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
  }).onConflictDoUpdate({
    target: organizationSubscriptions.organizationId,
    set: { planTier, status: "active", billingProvider: "manual", currentPeriodEnd },
  });
}

async function enableAllAddons(organizationId: string) {
  console.log("  Enabling all add-ons...");
  
  for (const addonKey of ALL_ADDONS) {
    await db.insert(organizationAddOns).values({
      organizationId,
      addonKey,
      status: "active",
    }).onConflictDoUpdate({
      target: [organizationAddOns.organizationId, organizationAddOns.addonKey],
      set: { status: "active" },
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
    }).onConflictDoUpdate({
      target: users.email,
      set: {
        organizationId: orgId,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        passwordHash,
        isActive: true,
        walkthroughCompleted: true,
        walkthroughStep: 0,
      },
    });
    console.log(`    - ${user.email} (${user.role})`);
  }
}

async function seedMasterSowItems() {
  console.log("\n--- Seeding Master SOW Items ---");
  
  // Check if master items already exist
  const existingItems = await db.select().from(masterSowItems).limit(1);
  if (existingItems.length > 0) {
    console.log("  Master SOW items already exist, skipping...");
    return;
  }
  
  // Seed all master SOW items from trade expansion
  await seedAllNewTradeSowItems();
}

async function copyMasterSowToOrganization(organizationId: string, tradeType: string) {
  console.log("  Copying master SOW items to organization...");
  
  // Check if organization already has SOW items
  const existingOrgItems = await db.select().from(organizationSowItems)
    .where(eq(organizationSowItems.organizationId, organizationId))
    .limit(1);
  
  if (existingOrgItems.length > 0) {
    console.log("    Organization already has SOW items, skipping...");
    return;
  }
  
  // For General Contractor, get ALL master items; for specific trades, get only that trade
  const isGC = tradeType === "GENERAL_CONTRACTOR";
  
  let items;
  if (isGC) {
    items = await db.select().from(masterSowItems)
      .where(eq(masterSowItems.isActive, true))
      .orderBy(asc(masterSowItems.tradeType), asc(masterSowItems.sortOrder));
  } else {
    items = await db.select().from(masterSowItems)
      .where(and(
        eq(masterSowItems.tradeType, tradeType as any),
        eq(masterSowItems.isActive, true)
      ))
      .orderBy(asc(masterSowItems.sortOrder));
  }
  
  console.log(`    Found ${items.length} master items to copy...`);
  
  for (const item of items) {
    const categoryName = isGC 
      ? `${item.tradeType} - ${item.categoryName || 'General'}`
      : (item.categoryName || 'General');
    
    const itemCode = isGC
      ? `${item.tradeType}_${item.code}`
      : item.code;
    
    await db.insert(organizationSowItems).values({
      organizationId,
      categoryName,
      name: item.name,
      code: itemCode,
      description: item.description,
      unit: item.defaultUomCode || 'EA',
      displayOrder: item.sortOrder || 0,
      requiresDimensions: item.requiresDimensions || false,
      dimensionLabel: item.dimensionLabel,
      isFromTemplate: true,
      isActive: true,
    }).onConflictDoNothing();
  }
  
  console.log(`    Copied ${items.length} SOW items to organization`);
}

async function main() {
  console.log("========================================");
  console.log("  SmartManageAI Test Company Seeder");
  console.log("========================================\n");
  
  try {
    await cleanupExisting();
    
    // First ensure master SOW items are seeded
    await seedMasterSowItems();
    
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
    await copyMasterSowToOrganization(mainOrg.id, "GENERAL_CONTRACTOR");
    
    console.log("\n--- Creating Subcontractor Organization ---");
    const subOrg = await createOrganization(
      "RealTest Subcontractors",
      "realtest-subcontractors",
      "CONCRETE",
      true
    );
    
    await createSubscription(subOrg.id, "professional");
    await createUsers(subOrg.id, SUB_ORG_USERS);
    await copyMasterSowToOrganization(subOrg.id, "CONCRETE");
    
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
