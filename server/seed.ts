import { logError } from "./utils/logger";
import { db } from "./db";
import { users, projects, bids, scopeItems, projectNotes, timeEntries, changeOrders, calendarEvents, notifications, organizations, emailAccounts, emailThreads, emailMessages, tasks } from "@shared/schema";
import { hashPassword } from "./auth";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Seeding database...");

  const existingUsers = await db.select().from(users).limit(1);

  if (existingUsers.length > 0) {
    console.log("✅ Users already exist, skipping seed");
    return;
  }

  const [demoOrg] = await db.insert(organizations).values({
    name: "TFR Construction",
    slug: "tfr-construction",
    tradeType: "GENERAL_CONTRACTOR",
    tradeName: "TFR Construction LLC",
    city: "Columbus",
    state: "OH",
    phone: "(614) 555-0001",
    email: "info@tfrconst.com",
  }).returning();

  console.log("✅ Demo organization created");

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
      organizationId: demoOrg.id,
    },
    {
      firstName: "Sarah",
      lastName: "Williams",
      email: "sarah@tfrconst.com",
      role: "MANAGER",
      isActive: true,
      passwordHash: demoPasswordHash,
      organizationId: demoOrg.id,
    },
    {
      firstName: "Jake",
      lastName: "Brown",
      email: "jake@tfrconstructionohio.com",
      role: "SUPERINTENDENT",
      isActive: true,
      passwordHash: demoPasswordHash,
      organizationId: demoOrg.id,
    },
    {
      firstName: "Mike",
      lastName: "Johnson",
      email: "mike@tfrllc.com",
      role: "HOURLY_EMPLOYEE",
      isActive: true,
      passwordHash: demoPasswordHash,
      organizationId: demoOrg.id,
    },
  ]).returning();

  const [admin, manager, superintendent, employee] = createdUsers;

  console.log("✅ Demo users created");

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
      gcOrganizationId: demoOrg.id,
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
      gcOrganizationId: demoOrg.id,
    },
  ]);

  console.log("✅ Demo bids created");

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
      gcOrganizationId: demoOrg.id,
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
      gcOrganizationId: demoOrg.id,
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
      gcOrganizationId: demoOrg.id,
    },
  ]).returning();

  const [libraryProject, retailProject, medicalProject] = createdProjects;

  console.log("✅ Demo projects created");

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

  const [emailAccount] = await db.insert(emailAccounts).values({
    organizationId: demoOrg.id,
    userId: admin.id,
    provider: "GMAIL",
    emailAddress: "admin@tfrllc.com",
    displayName: "TFR Construction",
    isActive: true,
    lastSyncedAt: new Date("2024-11-18T08:00:00Z"),
  }).returning();

  console.log("✅ Demo email account created");

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  const threadData = [
    {
      subject: "RE: RFI #27 - HVAC Ductwork Routing Through Library Atrium",
      projectId: libraryProject.id,
      status: "OPEN" as const,
      messageCount: 3,
      unreadCount: 1,
      lastMessageAt: hoursAgo(2),
      primaryClassification: "BID_RFI" as const,
      aiSummary: "RFI #27 regarding HVAC ductwork routing through the library atrium space. Architect has requested clarification on soffit depth and coordination with structural beams. Mechanical engineer responded with revised routing plan. Awaiting GC confirmation on clearance dimensions.",
      aiMetadata: JSON.stringify({ priority: "HIGH", entities: ["RFI #27", "HVAC", "atrium"], actionRequired: true }),
    },
    {
      subject: "Change Order Request - Additional Electrical Panel (Retail Phase 2)",
      projectId: retailProject.id,
      status: "OPEN" as const,
      messageCount: 4,
      unreadCount: 2,
      lastMessageAt: hoursAgo(5),
      primaryClassification: "CHANGE_ORDER_REQUEST" as const,
      aiSummary: "Request for additional 200A electrical panel in Building C to accommodate tenant HVAC requirements not in original scope. Subcontractor provided quote of $12,400. Owner rep has asked for cost breakdown before approval.",
      aiMetadata: JSON.stringify({ priority: "HIGH", entities: ["CO-003", "200A panel", "Building C"], estimatedCost: "$12,400" }),
    },
    {
      subject: "Submittal Review - Carpet Tile Selections (Library Reading Rooms)",
      projectId: libraryProject.id,
      status: "OPEN" as const,
      messageCount: 3,
      unreadCount: 0,
      lastMessageAt: daysAgo(1),
      primaryClassification: "SUBMITTAL_REQUEST" as const,
      aiSummary: "Interface carpet tile submittal for library reading rooms. Three options presented: Shaw Contract 'Dye Lab', Mohawk Group 'Relaxed Approach', and Mannington 'Sketch'. City facilities manager prefers Shaw option. Awaiting architect final approval.",
      aiMetadata: JSON.stringify({ priority: "MEDIUM", entities: ["Shaw Contract", "Mohawk Group", "Mannington"], dueDate: "2024-12-06" }),
    },
    {
      subject: "RE: Concrete Pour Schedule - Building B Foundation",
      projectId: retailProject.id,
      status: "OPEN" as const,
      messageCount: 3,
      unreadCount: 1,
      lastMessageAt: hoursAgo(8),
      primaryClassification: "PROJECT_UPDATE" as const,
      aiSummary: "Scheduling concrete pour for Building B foundation. Ready-mix supplier confirmed availability for next Tuesday. Need 45 CY for footings and 120 CY for slab. Weather forecast looks clear. Pump truck reserved.",
      aiMetadata: JSON.stringify({ priority: "MEDIUM", entities: ["Building B", "165 CY total", "Tuesday pour"], weatherDependent: true }),
    },
    {
      subject: "Invoice Discrepancy - Plumbing Materials PO #4521",
      projectId: libraryProject.id,
      status: "OPEN" as const,
      messageCount: 4,
      unreadCount: 0,
      lastMessageAt: hoursAgo(3),
      primaryClassification: "INVOICE" as const,
      aiSummary: "Ferguson Enterprises invoice #INV-88432 shows $3,200 overage versus PO #4521. Discrepancy traced to copper fitting price increase effective Nov 1. Supplier willing to honor original pricing for this order if we confirm by Friday.",
      aiMetadata: JSON.stringify({ priority: "HIGH", entities: ["PO #4521", "INV-88432", "Ferguson Enterprises"], amount: "$3,200 overage" }),
    },
    {
      subject: "Roofing Subcontractor Pre-Qualification Documents",
      projectId: retailProject.id,
      status: "OPEN" as const,
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: daysAgo(2),
      primaryClassification: "VENDOR_PRICING" as const,
      aiSummary: "Apex Roofing submitted pre-qualification package for Retail Phase 2 roofing scope. Includes insurance certs, safety record (0.85 EMR), and 3 reference projects. Need to verify bond capacity for $81,000 scope.",
      aiMetadata: JSON.stringify({ priority: "MEDIUM", entities: ["Apex Roofing", "EMR 0.85", "$81,000 scope"] }),
    },
    {
      subject: "Steel Beam Delivery Confirmation - Week of 12/2",
      projectId: retailProject.id,
      status: "OPEN" as const,
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: daysAgo(1),
      primaryClassification: "DELIVERY_NOTICE" as const,
      aiSummary: "Nucor steel delivery confirmed for Monday 12/2. 15 tons of W12x26 beams and 8 tons of W8x18 beams. Delivery window 7:00-9:00 AM. Crane needs to be on site. Requesting unloading area be cleared by Friday.",
      aiMetadata: JSON.stringify({ priority: "LOW", entities: ["Nucor", "23 tons total", "12/2 delivery"], deliveryDate: "2024-12-02" }),
    },
    {
      subject: "URGENT: Safety Incident Report - Ladder Fall Near-Miss",
      projectId: libraryProject.id,
      status: "OPEN" as const,
      messageCount: 3,
      unreadCount: 1,
      lastMessageAt: hoursAgo(1),
      primaryClassification: "SAFETY_ISSUE" as const,
      aiSummary: "Near-miss incident reported on 2nd floor library renovation. Worker's ladder slipped on wet surface during painting prep. No injuries. Root cause: floor not properly dried after cleaning. Corrective action: mandatory ladder safety refresher and wet floor protocols.",
      aiMetadata: JSON.stringify({ priority: "CRITICAL", entities: ["2nd floor", "ladder incident", "near-miss"], incidentType: "near-miss" }),
    },
    {
      subject: "Invitation to Bid - Westerville School District Gymnasium Renovation",
      projectId: null,
      status: "OPEN" as const,
      messageCount: 2,
      unreadCount: 1,
      lastMessageAt: daysAgo(1),
      primaryClassification: "BID_INVITE" as const,
      aiSummary: "Westerville City Schools inviting bids for gymnasium renovation at Central High School. Scope includes flooring replacement, bleacher refurbishment, lighting upgrade to LED, and HVAC improvements. Estimated value $350K-$450K. Pre-bid meeting Dec 5, bids due Dec 20.",
      aiMetadata: JSON.stringify({ priority: "MEDIUM", entities: ["Westerville Schools", "Central High", "$350K-$450K"], dueDate: "2024-12-20" }),
    },
    {
      subject: "RE: Weekly Progress Meeting Notes - Library Renovation (Week 8)",
      projectId: libraryProject.id,
      status: "ARCHIVED" as const,
      messageCount: 2,
      unreadCount: 0,
      lastMessageAt: daysAgo(3),
      primaryClassification: "GENERAL_COMMUNICATION" as const,
      aiSummary: "Week 8 progress meeting summary. HVAC 75% complete, electrical 40% complete, painting prep underway. Schedule on track. Client satisfied with progress. Next milestone: HVAC substantial completion Dec 1.",
      aiMetadata: JSON.stringify({ priority: "LOW", entities: ["Week 8", "HVAC 75%", "electrical 40%"] }),
    },
  ];

  const createdThreads = await db.insert(emailThreads).values(
    threadData.map(t => ({
      organizationId: demoOrg.id,
      emailAccountId: emailAccount.id,
      subject: t.subject,
      projectId: t.projectId,
      status: t.status,
      messageCount: t.messageCount,
      unreadCount: t.unreadCount,
      lastMessageAt: t.lastMessageAt,
      primaryClassification: t.primaryClassification,
      aiSummary: t.aiSummary,
      aiMetadata: t.aiMetadata,
    }))
  ).returning();

  console.log("✅ Demo email threads created");

  const messageData = [
    {
      threadIdx: 0,
      messages: [
        { fromAddress: "mark.daniels@hvacsolutions.com", fromName: "Mark Daniels", subject: "RFI #27 - HVAC Ductwork Routing Through Library Atrium", bodyText: "Hi Sarah,\n\nPer our discussion on site, we need clarification on the ductwork routing through the atrium space. The current drawings show a 24\" main trunk line running east-west, but the structural beams at grid lines C and D reduce our available soffit depth to 14\".\n\nCan we get the architect to confirm whether we can route below the beams with a modified soffit, or if we need to reroute through the adjacent corridor?\n\nThis is holding up our fabrication schedule. Please advise ASAP.\n\nThanks,\nMark Daniels\nHVAC Solutions Inc.", receivedAt: daysAgo(3), isIncoming: true, isRead: true, classification: "BID_RFI" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: RFI #27 - HVAC Ductwork Routing Through Library Atrium", bodyText: "Mark,\n\nGood catch on the clearance issue. I've forwarded this to Thompson Architecture for review. They're looking at two options:\n\n1. Modified soffit detail to accommodate the 24\" trunk below beams\n2. Split the trunk into dual 16\" runs through the corridor\n\nWe should have their response by end of day tomorrow. I'll keep you posted.\n\nSarah Williams\nTFR Construction", receivedAt: daysAgo(2), isIncoming: false, isRead: true, classification: "BID_RFI" as const },
        { fromAddress: "j.newman@thompsonarch.com", fromName: "Jim Newman", subject: "RE: RFI #27 - HVAC Ductwork Routing Through Library Atrium", bodyText: "Sarah / Mark,\n\nWe've reviewed the routing conflict. Option 2 (dual 16\" runs) is preferred as it maintains the atrium ceiling height the client requested. I've attached a revised routing plan showing the corridor path.\n\nPlease confirm the corridor has adequate clearance (minimum 18\" below structure) and we'll issue a formal RFI response.\n\nJim Newman, AIA\nThompson Architecture", receivedAt: hoursAgo(2), isIncoming: true, isRead: false, classification: "BID_RFI" as const },
      ],
    },
    {
      threadIdx: 1,
      messages: [
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "Change Order Request - Additional Electrical Panel (Retail Phase 2)", bodyText: "Sarah,\n\nWe need an additional 200A electrical panel in Building C. The tenant for Unit 7 requires dedicated HVAC circuits that exceed the capacity of the existing panel. This was not included in the original electrical scope.\n\nI've gotten a quote from Buckeye Electric: $12,400 installed, including panel, breakers, conduit run from main switchgear, and all connections.\n\nPlease draft CO-003 for owner approval.\n\nJake", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "CHANGE_ORDER_REQUEST" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Change Order Request - Additional Electrical Panel (Retail Phase 2)", bodyText: "Jake,\n\nThanks for getting the quote. I'll prepare CO-003. Before I send to Amy Chen at Redstone, can you get Buckeye Electric to provide a detailed cost breakdown? The owner rep usually wants to see labor vs. materials split.\n\nAlso, what's the lead time on the panel? We need to make sure this doesn't impact the Unit 7 turnover date.\n\nSarah", receivedAt: daysAgo(1), isIncoming: false, isRead: true, classification: "CHANGE_ORDER_REQUEST" as const },
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "RE: Change Order Request - Additional Electrical Panel (Retail Phase 2)", bodyText: "Sarah,\n\nBreakdown from Buckeye:\n- Panel & breakers: $4,200 (materials)\n- Conduit & wire: $2,800 (materials)\n- Labor (32 hrs): $4,400\n- Permit fee: $600\n- Contingency: $400\nTotal: $12,400\n\nPanel lead time is 2 weeks from order. If we get approval this week, we can still make the Unit 7 schedule.\n\nJake", receivedAt: hoursAgo(8), isIncoming: true, isRead: false, classification: "CHANGE_ORDER_REQUEST" as const },
        { fromAddress: "amy@redstonedevelopment.com", fromName: "Amy Chen", subject: "RE: Change Order Request - Additional Electrical Panel (Retail Phase 2)", bodyText: "Sarah,\n\nThanks for the detailed breakdown. The cost seems reasonable given the scope. I need to run this by our finance team, but I expect approval by Wednesday.\n\nPlease go ahead and have the electrician order the panel now to protect the schedule. We'll formalize the CO paperwork once I have sign-off.\n\nAmy Chen\nRedstone Development", receivedAt: hoursAgo(5), isIncoming: true, isRead: false, classification: "CHANGE_ORDER_REQUEST" as const },
      ],
    },
    {
      threadIdx: 2,
      messages: [
        { fromAddress: "lisa.grant@interfacefloors.com", fromName: "Lisa Grant", subject: "Submittal - Carpet Tile Selections (Library Reading Rooms)", bodyText: "Hi Sarah,\n\nAttached are the three carpet tile options for the library reading rooms per spec section 09 68 13:\n\n1. Shaw Contract 'Dye Lab' - Style #54910, Color: Beaker\n2. Mohawk Group 'Relaxed Approach' - Style 12BY, Color: Casual\n3. Mannington 'Sketch' - Pattern #TL211, Color: Graphite\n\nAll meet the specified wear rating (TARR Heavy) and VOC requirements. Samples are being shipped to your office.\n\nPlease review and let me know which to submit formally to the architect.\n\nLisa Grant\nInterface Floors - Columbus Rep", receivedAt: daysAgo(4), isIncoming: true, isRead: true, classification: "SUBMITTAL_REQUEST" as const },
        { fromAddress: "r.martinez@columbus.gov", fromName: "Robert Martinez", subject: "RE: Submittal - Carpet Tile Selections (Library Reading Rooms)", bodyText: "Sarah,\n\nI reviewed the samples you forwarded. The Shaw Contract 'Dye Lab' in Beaker is our strong preference - it coordinates well with the existing millwork stain color we selected.\n\nPlease proceed with that option unless the architect has concerns.\n\nRobert Martinez\nCity of Columbus - Facilities Division", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "SUBMITTAL_REQUEST" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Submittal - Carpet Tile Selections (Library Reading Rooms)", bodyText: "Robert / Lisa,\n\nGreat - I've submitted Shaw Contract 'Dye Lab' to Thompson Architecture for formal approval. Jim said he'll review this week.\n\nLisa - once we get architect approval, what's the lead time for 12,000 SF? We need to coordinate with the painting schedule.\n\nSarah", receivedAt: daysAgo(1), isIncoming: false, isRead: true, classification: "SUBMITTAL_REQUEST" as const },
      ],
    },
    {
      threadIdx: 3,
      messages: [
        { fromAddress: "dave.wilson@centralohioconcrete.com", fromName: "Dave Wilson", subject: "Concrete Pour Schedule - Building B Foundation", bodyText: "Jake,\n\nWe're ready to schedule the Building B foundation pour. Here's what we need:\n\n- Footings: 45 CY of 4000 PSI mix\n- Slab on grade: 120 CY of 3500 PSI with fiber mesh\n- Pump truck: 42m boom\n\nI can have trucks rolling starting 6:30 AM. What day works next week? I need 48 hours notice for the batch plant.\n\nDave Wilson\nCentral Ohio Concrete", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "PROJECT_UPDATE" as const },
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "RE: Concrete Pour Schedule - Building B Foundation", bodyText: "Dave,\n\nTuesday looks good. Weather forecast is clear and mid-40s, which works. We'll have the forms stripped and rebar inspected by Monday afternoon.\n\nCan you confirm the pump truck is reserved? Also, we'll need a finisher crew for the slab - our guys will handle the footings.\n\nI'll send the access map for truck staging.\n\nJake", receivedAt: daysAgo(1), isIncoming: false, isRead: true, classification: "PROJECT_UPDATE" as const },
        { fromAddress: "dave.wilson@centralohioconcrete.com", fromName: "Dave Wilson", subject: "RE: Concrete Pour Schedule - Building B Foundation", bodyText: "Jake,\n\nTuesday confirmed. Pump truck is reserved. I'll have our finishing crew (4 guys) there for the slab pour.\n\nFirst truck at 6:30 AM, footings first, then we'll move to slab after lunch. Should be wrapped up by 3:00 PM if everything goes smoothly.\n\nI'll send batch tickets the day before.\n\nDave", receivedAt: hoursAgo(8), isIncoming: true, isRead: false, classification: "PROJECT_UPDATE" as const },
      ],
    },
    {
      threadIdx: 4,
      messages: [
        { fromAddress: "ap@tfrconst.com", fromName: "TFR Accounts Payable", subject: "Invoice Discrepancy - Plumbing Materials PO #4521", bodyText: "Sarah,\n\nFerguson Enterprises invoice #INV-88432 doesn't match PO #4521. Here are the discrepancies:\n\n- 3/4\" copper elbows: PO price $4.85/ea, invoiced at $6.20/ea (qty 200)\n- 1\" copper tees: PO price $8.50/ea, invoiced at $9.75/ea (qty 150)\n\nTotal overage: $3,197.50\n\nCan you check with the supplier? This is outside our 5% tolerance.\n\nAP Department", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "INVOICE" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Invoice Discrepancy - Plumbing Materials PO #4521", bodyText: "Thanks for catching this. I'll reach out to our Ferguson rep today.\n\nSarah", receivedAt: daysAgo(2), isIncoming: false, isRead: true, classification: "INVOICE" as const },
        { fromAddress: "tom.harris@ferguson.com", fromName: "Tom Harris", subject: "RE: Invoice Discrepancy - Plumbing Materials PO #4521", bodyText: "Sarah,\n\nYou're right - there was a copper fitting price increase on Nov 1 that our system automatically applied. Since your PO was placed Oct 28 and delivered Nov 5, the original PO pricing should apply.\n\nI can issue a credit memo for the $3,197.50 difference, or we can honor the original pricing on a revised invoice. Let me know your preference.\n\nApologies for the confusion.\n\nTom Harris\nFerguson Enterprises - Commercial Division", receivedAt: hoursAgo(6), isIncoming: true, isRead: true, classification: "INVOICE" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Invoice Discrepancy - Plumbing Materials PO #4521", bodyText: "Tom,\n\nRevised invoice at original PO pricing would be preferred - cleaner for our records. Please have it reissued referencing PO #4521 and we'll process payment within our standard 30-day terms.\n\nThanks for the quick resolution.\n\nSarah", receivedAt: hoursAgo(3), isIncoming: false, isRead: true, classification: "INVOICE" as const },
      ],
    },
    {
      threadIdx: 5,
      messages: [
        { fromAddress: "rick.moreno@apexroofing.com", fromName: "Rick Moreno", subject: "Roofing Subcontractor Pre-Qualification Documents", bodyText: "Sarah,\n\nPer your request, here is our pre-qualification package for the Retail Shopping Center roofing scope:\n\n- Certificate of Insurance (GL $2M, Umbrella $5M)\n- EMR letter: 0.85 (3-year average)\n- Safety program summary\n- 3 completed project references (commercial, similar scope)\n- Financial statement (bonding capacity letter enclosed)\n\nWe can bond up to $500K per project. Our proposed crew is 6 roofers + 1 foreman. We estimate 4 weeks for the 180 SQ scope.\n\nLet me know if you need anything else.\n\nRick Moreno\nApex Roofing Co.", receivedAt: daysAgo(3), isIncoming: true, isRead: true, classification: "VENDOR_PRICING" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Roofing Subcontractor Pre-Qualification Documents", bodyText: "Rick,\n\nThanks for the thorough package. Everything looks good. A couple follow-up items:\n\n1. Can you send the actual bond letter specifically for this $81,000 scope?\n2. Do your references include any TPO membrane installations? Our spec calls for 60-mil TPO.\n\nI'd like to get you pre-qualified by end of next week so we can include you in the bid solicitation.\n\nSarah", receivedAt: daysAgo(2), isIncoming: false, isRead: true, classification: "VENDOR_PRICING" as const },
      ],
    },
    {
      threadIdx: 6,
      messages: [
        { fromAddress: "logistics@nucor.com", fromName: "Nucor Logistics", subject: "Steel Beam Delivery Confirmation - Week of 12/2", bodyText: "TFR Construction - Jake Brown,\n\nThis confirms your steel delivery for the Retail Shopping Center project:\n\nDelivery Date: Monday, December 2, 2024\nDelivery Window: 7:00 AM - 9:00 AM\n\nItems:\n- W12x26 beams, 30' lengths (15 tons) - 6 pieces\n- W8x18 beams, 24' lengths (8 tons) - 8 pieces\n\nTruck: Flatbed with crane assist available\nDriver will call 30 minutes before arrival.\n\nPlease ensure unloading area is clear and accessible for a 53' trailer.\n\nNucor Steel Logistics", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "DELIVERY_NOTICE" as const },
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "RE: Steel Beam Delivery Confirmation - Week of 12/2", bodyText: "Confirmed. We'll have the laydown area cleared by Friday and the 50-ton crane on site Monday morning.\n\nDriver can enter through the east gate on Easton Way. I'll have a laborer flag traffic.\n\nJake Brown\nSuperintendent - TFR Construction", receivedAt: daysAgo(1), isIncoming: false, isRead: true, classification: "DELIVERY_NOTICE" as const },
      ],
    },
    {
      threadIdx: 7,
      messages: [
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "URGENT: Safety Incident Report - Ladder Fall Near-Miss", bodyText: "Sarah,\n\nReporting a near-miss incident that occurred this morning at the Library Renovation project:\n\nDate/Time: Today, 9:15 AM\nLocation: 2nd floor, Room 204 (reading room)\nDescription: A painter's 8' A-frame ladder slipped on a wet floor surface while he was descending. The worker grabbed the door frame and was not injured.\n\nRoot Cause: Floor had been mopped earlier and was not fully dry. No wet floor signs were posted.\n\nImmediate Actions Taken:\n1. Area secured and cleaned\n2. Wet floor signs placed\n3. All workers on site briefed\n\nI recommend we schedule a mandatory ladder safety refresher for the entire crew.\n\nJake", receivedAt: hoursAgo(4), isIncoming: true, isRead: true, classification: "SAFETY_ISSUE" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: URGENT: Safety Incident Report - Ladder Fall Near-Miss", bodyText: "Jake,\n\nThank you for the prompt report. Glad no one was hurt.\n\nPlease implement the following corrective actions:\n1. Schedule ladder safety refresher training for ALL site personnel by end of this week\n2. Update the housekeeping protocol to require 30-minute dry time after mopping before ladder use\n3. Add wet floor signage to the daily safety checklist\n4. Document everything in our safety log\n\nI'll notify our insurance carrier per our incident reporting protocol. Please have the injured worker fill out a near-miss report form even though there was no injury.\n\nSarah", receivedAt: hoursAgo(2), isIncoming: false, isRead: true, classification: "SAFETY_ISSUE" as const },
        { fromAddress: "jake@tfrconstructionohio.com", fromName: "Jake Brown", subject: "RE: URGENT: Safety Incident Report - Ladder Fall Near-Miss", bodyText: "Sarah,\n\nAll corrective actions underway:\n- Ladder safety refresher scheduled for Thursday 7:00 AM toolbox talk\n- Updated housekeeping SOP with dry time requirement\n- Added signage check to daily safety audit form\n- Near-miss report completed and filed\n\nI also spoke with the painting sub's foreman. They'll implement a buddy system for ladder work going forward.\n\nJake", receivedAt: hoursAgo(1), isIncoming: true, isRead: false, classification: "SAFETY_ISSUE" as const },
      ],
    },
    {
      threadIdx: 8,
      messages: [
        { fromAddress: "procurement@westervilleschools.org", fromName: "Westerville City Schools", subject: "Invitation to Bid - Westerville School District Gymnasium Renovation", bodyText: "Dear Contractor,\n\nWesterville City Schools is soliciting bids for the renovation of the Central High School gymnasium. Project details:\n\nScope of Work:\n- Gymnasium flooring replacement (maple hardwood)\n- Bleacher refurbishment (1,200 seats)\n- Lighting upgrade to LED\n- HVAC improvements (RTU replacement)\n- Painting and finishes\n\nEstimated Project Value: $350,000 - $450,000\n\nKey Dates:\n- Pre-Bid Meeting: December 5, 2024, 2:00 PM at Central High School\n- Bid Due Date: December 20, 2024, 2:00 PM\n- Anticipated Award: January 8, 2025\n- Construction Start: February 3, 2025\n- Substantial Completion: May 30, 2025\n\nBid documents available at www.westervilleschools.org/procurement\n\nWesterville City Schools Procurement Office", receivedAt: daysAgo(2), isIncoming: true, isRead: true, classification: "BID_INVITE" as const },
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "RE: Invitation to Bid - Westerville School District Gymnasium Renovation", bodyText: "Thank you for the invitation. TFR Construction is interested in bidding on this project. We will attend the pre-bid meeting on December 5.\n\nCould you please confirm:\n1. Is there a bid bond requirement?\n2. Are prevailing wages required?\n3. Is there an MBE/WBE participation goal?\n\nSarah Williams\nEstimating Department\nTFR Construction LLC", receivedAt: daysAgo(1), isIncoming: false, isRead: true, classification: "BID_INVITE" as const },
      ],
    },
    {
      threadIdx: 9,
      messages: [
        { fromAddress: "sarah@tfrconst.com", fromName: "Sarah Williams", subject: "Weekly Progress Meeting Notes - Library Renovation (Week 8)", bodyText: "Team,\n\nHere are the minutes from today's Week 8 progress meeting at the Municipal Library Renovation:\n\nAttendees: Sarah Williams (TFR), Jake Brown (TFR), Robert Martinez (City), Jim Newman (Architect)\n\nProgress Summary:\n- HVAC: 75% complete. Main air handlers installed, ductwork in progress.\n- Electrical: 40% complete. Panel upgrades done, branch circuits underway.\n- Painting: Prep work started in reading rooms.\n- Carpet: Submittal under review (Shaw 'Dye Lab' preferred).\n\nSchedule Status: ON TRACK\n- Next milestone: HVAC substantial completion Dec 1\n\nOpen Items:\n- RFI #27 ductwork routing (pending architect response)\n- CO-001 data cabling approved and in progress\n\nNext meeting: Same time next week.\n\nSarah", receivedAt: daysAgo(4), isIncoming: false, isRead: true, classification: "GENERAL_COMMUNICATION" as const },
        { fromAddress: "r.martinez@columbus.gov", fromName: "Robert Martinez", subject: "RE: Weekly Progress Meeting Notes - Library Renovation (Week 8)", bodyText: "Sarah,\n\nGood summary, thanks. A couple of additions from our side:\n\n1. The library board meeting is Dec 10 - I'll need updated photos for the progress report\n2. We'd like to discuss the reading room furniture delivery schedule at next week's meeting\n\nOtherwise, we're very pleased with the progress. Keep up the great work.\n\nRobert Martinez\nCity of Columbus", receivedAt: daysAgo(3), isIncoming: true, isRead: true, classification: "GENERAL_COMMUNICATION" as const },
      ],
    },
  ];

  for (const thread of messageData) {
    const createdThread = createdThreads[thread.threadIdx];
    const externalAddresses = thread.messages
      .filter(m => m.isIncoming)
      .map(m => m.fromAddress);
    const primaryExternalAddress = externalAddresses[0] || "recipient@example.com";

    await db.insert(emailMessages).values(
      thread.messages.map((m, idx) => ({
        organizationId: demoOrg.id,
        emailAccountId: emailAccount.id,
        threadId: createdThread.id,
        externalId: `demo-msg-${thread.threadIdx}-${idx}`,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        toAddresses: JSON.stringify(m.isIncoming ? ["admin@tfrllc.com"] : [primaryExternalAddress]),
        subject: m.subject,
        bodyText: m.bodyText,
        snippet: m.bodyText.substring(0, 150),
        receivedAt: m.receivedAt,
        isRead: m.isRead,
        isIncoming: m.isIncoming,
        hasAttachments: false,
        classification: m.classification,
        aiAnalyzedAt: new Date(),
      }))
    );
  }

  console.log("✅ Demo email messages created");

  await db.insert(tasks).values([
    {
      organizationId: demoOrg.id,
      title: "Respond to RFI #27 - Confirm corridor clearance for dual ductwork runs",
      description: "Architect Jim Newman has proposed dual 16\" runs through the corridor instead of the atrium. Need to verify corridor clearance (min 18\" below structure) and send confirmation.",
      category: "CLIENT_COMMUNICATION",
      priority: "HIGH",
      status: "PENDING",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[0].id,
      createdById: admin.id,
      assignedToId: superintendent.id,
      dueDate: daysAgo(-2),
      projectId: libraryProject.id,
    },
    {
      organizationId: demoOrg.id,
      title: "Submit CO-003 for additional electrical panel - Building C",
      description: "Owner rep Amy Chen expects approval by Wednesday. Electrical sub needs to order panel (2-week lead time). Get formal CO documentation to Redstone Development.",
      category: "CHANGE_ORDER",
      priority: "HIGH",
      status: "PENDING",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[1].id,
      createdById: admin.id,
      assignedToId: manager.id,
      dueDate: daysAgo(-1),
      projectId: retailProject.id,
    },
    {
      organizationId: demoOrg.id,
      title: "Follow up on carpet tile architect approval",
      description: "Shaw Contract 'Dye Lab' submitted to Thompson Architecture. Need approval to proceed with ordering 12,000 SF. Coordinate lead time with painting schedule.",
      category: "CLIENT_COMMUNICATION",
      priority: "MEDIUM",
      status: "PENDING",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[2].id,
      createdById: admin.id,
      assignedToId: manager.id,
      dueDate: daysAgo(-3),
      projectId: libraryProject.id,
    },
    {
      organizationId: demoOrg.id,
      title: "Resolve invoice discrepancy with Ferguson Enterprises",
      description: "Ferguson agreed to reissue invoice #INV-88432 at original PO #4521 pricing. Confirm revised invoice received and forward to AP for processing.",
      category: "OTHER",
      priority: "HIGH",
      status: "IN_PROGRESS",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[4].id,
      createdById: admin.id,
      assignedToId: manager.id,
      dueDate: daysAgo(-1),
      projectId: libraryProject.id,
    },
    {
      organizationId: demoOrg.id,
      title: "Schedule mandatory ladder safety refresher training",
      description: "Following the near-miss incident on 2nd floor, all site personnel need ladder safety refresher. Jake has scheduled Thursday 7:00 AM toolbox talk. Ensure attendance is documented.",
      category: "SAFETY",
      priority: "CRITICAL",
      status: "PENDING",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[7].id,
      createdById: admin.id,
      assignedToId: superintendent.id,
      dueDate: daysAgo(-1),
      projectId: libraryProject.id,
    },
    {
      organizationId: demoOrg.id,
      title: "Attend Westerville Schools pre-bid meeting",
      description: "Pre-bid meeting for gymnasium renovation at Central High School on December 5 at 2:00 PM. Estimated project value $350K-$450K. Confirm attendance and review bid documents.",
      category: "OTHER",
      priority: "MEDIUM",
      status: "PENDING",
      sourceType: "EMAIL",
      emailThreadId: createdThreads[8].id,
      createdById: admin.id,
      assignedToId: manager.id,
      dueDate: new Date("2024-12-05"),
    },
  ]);

  console.log("✅ Demo email tasks created");

  console.log("\n✅ Demo users created:");
  console.log("   1. admin@tfrllc.com (ADMIN)");
  console.log("   2. sarah@tfrconst.com (MANAGER)");
  console.log("   3. jake@tfrconstructionohio.com (SUPERINTENDENT)");
  console.log("   4. mike@tfrllc.com (HOURLY_EMPLOYEE)");
  console.log("   Credentials use default seed values — change them in production!");
}

seed()
  .then(() => {
    console.log("🎉 Seeding complete!");
    process.exit(0);
  })
  .catch((error) => {
    logError("❌ Seeding failed:", {}, error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
