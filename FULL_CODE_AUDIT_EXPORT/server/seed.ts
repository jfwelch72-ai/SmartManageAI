import { db } from "./db";
import { users, projects, bids, scopeItems, projectNotes, timeEntries, changeOrders, calendarEvents, notifications } from "@shared/schema";
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
  
  const createdUsers = await db.insert(users).values([
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
    {
      firstName: "Mike",
      lastName: "Johnson",
      email: "mike@tfrllc.com",
      role: "HOURLY_EMPLOYEE",
      isActive: true,
      passwordHash: demoPasswordHash,
    },
  ]).returning();

  const [admin, manager, superintendent, employee] = createdUsers;

  console.log("✅ Demo users created");

  // Create demo bids
  await db.insert(bids).values([
    {
      name: "Downtown Office Renovation",
      code: "BID-2025-001",
      clientName: "Acme Corporation",
      clientContactName: "John Smith",
      clientContactEmail: "john.smith@acme.com",
      clientContactPhone: "(555) 123-4567",
      bidAmount: "285000.00",
      dueDate: new Date("2025-12-15"),
      locationAddress: "456 Main St",
      city: "Columbus",
      state: "OH",
      description: "Complete interior renovation of 5th floor office space",
      estimatorId: manager.id,
    },
    {
      name: "Warehouse Expansion",
      code: "BID-2025-002",
      clientName: "Logistics Inc",
      clientContactName: "Jane Doe",
      clientContactEmail: "jane@logistics.com",
      bidAmount: "450000.00",
      dueDate: new Date("2025-11-30"),
      locationAddress: "789 Industrial Blvd",
      city: "Cleveland",
      state: "OH",
      description: "10,000 sq ft warehouse addition with loading docks",
      estimatorId: manager.id,
    },
  ]);

  console.log("✅ Demo bids created");

  // Create demo active projects
  const createdProjects = await db.insert(projects).values([
    {
      name: "Municipal Library Renovation",
      code: "PROJ-2024-105",
      clientName: "City of Columbus",
      clientContactName: "Robert Martinez",
      clientContactEmail: "r.martinez@columbus.gov",
      clientContactPhone: "(614) 555-0100",
      status: "ACTIVE",
      locationAddress: "123 Library Lane",
      city: "Columbus",
      state: "OH",
      startDate: new Date("2024-10-01"),
      endDate: new Date("2025-03-31"),
      description: "Comprehensive renovation of main library building including HVAC, electrical, and interior finishes",
      estimatorId: manager.id,
      superintendentId: superintendent.id,
    },
    {
      name: "Retail Shopping Center - Phase 2",
      code: "PROJ-2024-098",
      clientName: "Redstone Development",
      clientContactName: "Amy Chen",
      clientContactEmail: "amy@redstonedevelopment.com",
      clientContactPhone: "(614) 555-0200",
      status: "ACTIVE",
      locationAddress: "4500 Easton Way",
      city: "Columbus",
      state: "OH",
      startDate: new Date("2024-09-15"),
      endDate: new Date("2025-06-30"),
      description: "Construction of 8 retail units with shared parking and landscaping",
      estimatorId: manager.id,
      superintendentId: superintendent.id,
    },
    {
      name: "Medical Office Build-Out",
      code: "PROJ-2024-112",
      clientName: "HealthFirst Medical Group",
      clientContactName: "Dr. Sarah Thompson",
      clientContactEmail: "s.thompson@healthfirst.com",
      status: "PLANNING",
      locationAddress: "2800 Medical Drive",
      city: "Dublin",
      state: "OH",
      startDate: new Date("2025-01-15"),
      endDate: new Date("2025-05-31"),
      description: "Medical office suite build-out with exam rooms, waiting area, and staff facilities",
      estimatorId: manager.id,
      superintendentId: superintendent.id,
    },
  ]).returning();

  const [libraryProject, retailProject, medicalProject] = createdProjects;

  console.log("✅ Demo projects created");

  // Create scope items for Library project
  await db.insert(scopeItems).values([
    {
      projectId: libraryProject.id,
      description: "HVAC System Replacement",
      unit: "LS",
      totalQuantity: "1.00",
      completedQuantity: "0.75",
      billedQuantity: "0.50",
      unitPrice: "125000.00",
      billingStatus: "READY_TO_BILL",
    },
    {
      projectId: libraryProject.id,
      description: "Interior Painting",
      unit: "SF",
      totalQuantity: "15000.00",
      completedQuantity: "8500.00",
      billedQuantity: "5000.00",
      unitPrice: "3.50",
      billingStatus: "NOT_READY",
    },
    {
      projectId: libraryProject.id,
      description: "Carpet Installation",
      unit: "SF",
      totalQuantity: "12000.00",
      completedQuantity: "12000.00",
      billedQuantity: "12000.00",
      unitPrice: "8.75",
      billingStatus: "BILLED",
      lastBilledDate: new Date("2024-10-31"),
    },
    {
      projectId: libraryProject.id,
      description: "Electrical Upgrades",
      unit: "LS",
      totalQuantity: "1.00",
      completedQuantity: "0.40",
      billedQuantity: "0.00",
      unitPrice: "85000.00",
      billingStatus: "NOT_READY",
    },
  ]);

  // Create scope items for Retail project
  await db.insert(scopeItems).values([
    {
      projectId: retailProject.id,
      description: "Foundation and Slab",
      unit: "SF",
      totalQuantity: "25000.00",
      completedQuantity: "25000.00",
      billedQuantity: "25000.00",
      unitPrice: "12.50",
      billingStatus: "BILLED",
      lastBilledDate: new Date("2024-10-15"),
    },
    {
      projectId: retailProject.id,
      description: "Steel Framing",
      unit: "TON",
      totalQuantity: "45.00",
      completedQuantity: "30.00",
      billedQuantity: "15.00",
      unitPrice: "2800.00",
      billingStatus: "READY_TO_BILL",
    },
    {
      projectId: retailProject.id,
      description: "Roofing System",
      unit: "SQ",
      totalQuantity: "180.00",
      completedQuantity: "0.00",
      billedQuantity: "0.00",
      unitPrice: "450.00",
      billingStatus: "NOT_READY",
    },
  ]);

  console.log("✅ Demo scope items created");

  // Create project notes
  await db.insert(projectNotes).values([
    {
      projectId: libraryProject.id,
      authorId: superintendent.id,
      noteType: "FIELD_NOTE",
      text: "HVAC contractor completed main air handler installation. Minor coordination needed with electrical for final connections.",
    },
    {
      projectId: libraryProject.id,
      authorId: manager.id,
      noteType: "CLIENT_MEETING",
      text: "Met with city representative. They are pleased with progress. Requested we expedite reading room carpet installation if possible.",
    },
    {
      projectId: retailProject.id,
      authorId: superintendent.id,
      noteType: "SAFETY",
      text: "Conducted weekly safety meeting. Reviewed proper ladder usage and fall protection requirements for upcoming roof work.",
    },
  ]);

  console.log("✅ Demo project notes created");

  // Create time entries
  await db.insert(timeEntries).values([
    {
      userId: employee.id,
      projectId: libraryProject.id,
      date: new Date("2024-11-15"),
      hoursRegular: "8.00",
      hoursOvertime: "0.00",
      costCode: "HVAC-INSTALL",
      notes: "Assisted with air handler rigging and installation",
      approvedById: manager.id,
      approvedAt: new Date("2024-11-16"),
    },
    {
      userId: employee.id,
      projectId: libraryProject.id,
      date: new Date("2024-11-16"),
      hoursRegular: "8.00",
      hoursOvertime: "2.00",
      costCode: "PAINT",
      notes: "Prep work in reading rooms",
    },
    {
      userId: superintendent.id,
      projectId: retailProject.id,
      date: new Date("2024-11-15"),
      hoursRegular: "9.00",
      hoursOvertime: "0.00",
      notes: "Site supervision and coordination",
      approvedById: manager.id,
      approvedAt: new Date("2024-11-16"),
    },
  ]);

  console.log("✅ Demo time entries created");

  // Create change orders
  await db.insert(changeOrders).values([
    {
      projectId: libraryProject.id,
      changeOrderNumber: "CO-001",
      description: "Additional Data Cabling - Client requested 20 additional network drops in staff offices",
      amount: "8500.00",
      status: "APPROVED",
      requestedById: superintendent.id,
      approvedById: manager.id,
      approvedAt: new Date("2024-11-10"),
    },
    {
      projectId: retailProject.id,
      changeOrderNumber: "CO-002",
      description: "Upgraded Storefront Glass - Owner elected to upgrade to high-performance insulated glass",
      amount: "15750.00",
      status: "PENDING_APPROVAL",
      requestedById: superintendent.id,
    },
  ]);

  console.log("✅ Demo change orders created");

  // Create calendar events
  await db.insert(calendarEvents).values([
    {
      userId: employee.id,
      eventType: "TIME_OFF_REQUEST",
      title: "Vacation Request",
      description: "Holiday vacation with family",
      startDate: new Date("2024-12-23"),
      endDate: new Date("2024-12-27"),
      allDay: true,
      createdById: employee.id,
    },
    {
      userId: superintendent.id,
      eventType: "TIME_OFF_APPROVED",
      title: "Personal Day",
      description: "Approved personal day",
      startDate: new Date("2024-11-22"),
      endDate: new Date("2024-11-22"),
      allDay: true,
      approvedById: manager.id,
      approvedAt: new Date("2024-11-18"),
      createdById: superintendent.id,
    },
    {
      userId: manager.id,
      eventType: "PROJECT_MILESTONE",
      title: "Library Project - HVAC Substantial Completion",
      description: "Target date for HVAC system substantial completion",
      startDate: new Date("2024-12-01"),
      endDate: new Date("2024-12-01"),
      allDay: true,
      projectId: libraryProject.id,
      createdById: manager.id,
    },
  ]);

  console.log("✅ Demo calendar events created");

  // Create notifications
  await db.insert(notifications).values([
    {
      userId: manager.id,
      type: "BILLING_READY",
      title: "Items Ready to Bill",
      message: "PROJ-2024-105: HVAC System Replacement is ready to bill ($93,750.00)",
      relatedEntityId: libraryProject.id,
      relatedEntityType: "project",
      isRead: false,
    },
    {
      userId: manager.id,
      type: "CHANGE_ORDER_PENDING",
      title: "Change Order Pending Approval",
      message: "PROJ-2024-098: Upgraded Storefront Glass requires approval ($15,750.00)",
      relatedEntityId: retailProject.id,
      relatedEntityType: "project",
      isRead: false,
    },
    {
      userId: manager.id,
      type: "TIME_OFF_REQUEST",
      title: "Time Off Request",
      message: "Mike Johnson requested vacation Dec 23-27, 2024",
      isRead: false,
    },
  ]);

  console.log("✅ Demo notifications created");

  console.log("\n✅ Demo users created:");
  console.log("   1. admin@tfrllc.com / admin123 (ADMIN)");
  console.log("   2. sarah@tfrconst.com / password123 (MANAGER)");
  console.log("   3. jake@tfrconstructionohio.com / password123 (SUPERINTENDENT)");
  console.log("   4. mike@tfrllc.com / password123 (HOURLY_EMPLOYEE)");
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
