// Role-specific walkthrough content for new users
// Each role has a tailored set of steps to learn their key tasks

export interface WalkthroughStep {
  stepNumber: number;
  title: string;
  description: string;
  action: string;
  targetPage: string;
  tips: string[];
}

export interface RoleWalkthrough {
  role: string;
  roleName: string;
  welcomeMessage: string;
  steps: WalkthroughStep[];
  completionMessage: string;
}

export const ROLE_WALKTHROUGHS: Record<string, RoleWalkthrough> = {
  SUPER_ADMIN: {
    role: "SUPER_ADMIN",
    roleName: "Platform Administrator",
    welcomeMessage: "Welcome, Platform Administrator! You have full access to monitor all organizations using the platform, assist with issues, and view analytics. Let me show you around.",
    steps: [
      {
        stepNumber: 1,
        title: "Platform Overview",
        description: "As a Super Admin, you can see all organizations, users, and activity across the entire platform.",
        action: "Your dashboard provides an overview of platform health, active organizations, and any issues requiring attention.",
        targetPage: "/dashboard",
        tips: [
          "Monitor platform-wide metrics and usage",
          "Identify organizations that may need assistance",
          "Track platform adoption and growth"
        ]
      },
      {
        stepNumber: 2,
        title: "Organization Management",
        description: "View and manage all contractor organizations using the platform.",
        action: "Access the organization list to see all tenants, their trade types, and onboarding status.",
        targetPage: "/admin/organizations",
        tips: [
          "Review organization onboarding progress",
          "Assist organizations with configuration issues",
          "Monitor organization activity levels"
        ]
      },
      {
        stepNumber: 3,
        title: "User Support",
        description: "Help users across all organizations when the AI assistant cannot resolve their issues.",
        action: "Review support requests and user issues that need human intervention.",
        targetPage: "/admin/support",
        tips: [
          "Escalated issues from AI assistant appear here",
          "You can impersonate users to diagnose problems",
          "Document solutions for common issues"
        ]
      },
      {
        stepNumber: 4,
        title: "Platform Analytics",
        description: "View comprehensive analytics about platform usage, feature adoption, and trends.",
        action: "Explore the analytics dashboard for insights into how the platform is being used.",
        targetPage: "/admin/analytics",
        tips: [
          "Track feature usage across organizations",
          "Identify popular and underused features",
          "Monitor system performance metrics"
        ]
      },
      {
        stepNumber: 5,
        title: "System Configuration",
        description: "Manage platform-wide settings, trade templates, and system configurations.",
        action: "Review system settings and trade template configurations.",
        targetPage: "/admin/settings",
        tips: [
          "Update trade templates as industry needs evolve",
          "Configure default settings for new organizations",
          "Manage platform-wide integrations"
        ]
      }
    ],
    completionMessage: "Excellent! You're now familiar with the Platform Administrator tools. You have full access to monitor and support all organizations on the platform."
  },

  ADMIN: {
    role: "ADMIN",
    roleName: "Administrator",
    welcomeMessage: "Welcome to your new construction management platform! As an Administrator, you have full control over the system. Let me walk you through the key features you'll use to manage your organization.",
    steps: [
      {
        stepNumber: 1,
        title: "Dashboard Overview",
        description: "Your dashboard is your command center. Here you can see active projects, pending bids, recent messages, and key metrics at a glance.",
        action: "Take a look around your dashboard. Notice the widgets showing project status, upcoming events, and quick actions.",
        targetPage: "/dashboard",
        tips: [
          "Click any widget to dive deeper into that area",
          "The sidebar gives you quick access to all platform features",
          "Check the notification bell for important updates"
        ]
      },
      {
        stepNumber: 2,
        title: "User Management",
        description: "As an admin, you can add new users, assign roles, and manage permissions. Each role has specific access to different features.",
        action: "Let's explore the User Management section. You can add team members like estimators, superintendents, and field workers.",
        targetPage: "/users",
        tips: [
          "Assign appropriate roles based on job responsibilities",
          "You can set hourly rates for employees here",
          "Deactivate users instead of deleting to preserve history"
        ]
      },
      {
        stepNumber: 3,
        title: "CRM & Vendors",
        description: "Build your network of vendors, suppliers, and contacts. Add pricing catalogs to speed up bid creation.",
        action: "Navigate to the CRM section and explore how to add vendors, suppliers, and their pricing catalogs.",
        targetPage: "/crm",
        tips: [
          "Add vendors with their specialty and contact info",
          "Import material pricing from vendor catalogs",
          "Link rental equipment to specific vendors"
        ]
      },
      {
        stepNumber: 4,
        title: "Equipment Fleet",
        description: "Track all your company equipment, tools, and vehicles. Assign them to projects and schedule maintenance.",
        action: "Check out the Equipment section to see how to add and manage your fleet and tools.",
        targetPage: "/equipment",
        tips: [
          "Log equipment hours for accurate depreciation",
          "Set up preventative maintenance schedules",
          "Assign equipment to specific projects"
        ]
      },
      {
        stepNumber: 5,
        title: "Projects & Bids",
        description: "View all active projects and pending bids. As admin, you can oversee everything happening across the company.",
        action: "Browse the Projects and Bids sections to see how work flows through the system.",
        targetPage: "/projects",
        tips: [
          "Track project status from planning to completion",
          "Review and approve change orders",
          "Monitor project profitability in real-time"
        ]
      }
    ],
    completionMessage: "Congratulations! You've completed the Admin walkthrough! You now know how to manage users, vendors, equipment, and oversee all projects. Your platform is ready to use!"
  },

  MANAGER: {
    role: "MANAGER",
    roleName: "Project Manager",
    welcomeMessage: "Welcome! As a Project Manager, you'll oversee projects, review bids, and coordinate between estimators and field teams. Let me show you the key features you'll use daily.",
    steps: [
      {
        stepNumber: 1,
        title: "Your Dashboard",
        description: "Your dashboard shows projects you're managing, pending approvals, and team communications.",
        action: "Explore your dashboard to see your assigned projects, upcoming deadlines, and action items.",
        targetPage: "/dashboard",
        tips: [
          "The AI Assistant can help generate tasks and schedules",
          "Check the calendar for upcoming project milestones",
          "Review the delay alerts section daily"
        ]
      },
      {
        stepNumber: 2,
        title: "Bid Review & Approval",
        description: "Review bids from estimators, check pricing, and approve them for submission to clients.",
        action: "Navigate to Bids to see pending estimates and learn how to review and approve them.",
        targetPage: "/bids",
        tips: [
          "Review the cost breakdown and profit margins",
          "Check vendor pricing accuracy",
          "Add notes before approving or returning for revision"
        ]
      },
      {
        stepNumber: 3,
        title: "Project Management",
        description: "Monitor active projects, track progress, and handle change orders.",
        action: "Open an active project to see schedules, daily reports, and financials.",
        targetPage: "/projects",
        tips: [
          "Review daily field reports from superintendents",
          "Track labor hours and material costs",
          "Process change orders promptly"
        ]
      },
      {
        stepNumber: 4,
        title: "Change Order Management",
        description: "Handle scope changes, additional work, and billing adjustments.",
        action: "Learn how to create, review, and approve change orders.",
        targetPage: "/change-orders",
        tips: [
          "Document all scope changes thoroughly",
          "Link supporting photos and documents",
          "Track approval status and billing"
        ]
      },
      {
        stepNumber: 5,
        title: "Team Communication",
        description: "Stay connected with your team through the messaging system.",
        action: "Check out the Messages section to communicate with estimators, superintendents, and crews.",
        targetPage: "/messages",
        tips: [
          "Create project-specific channels",
          "Share documents and photos in conversations",
          "Use the company channel for announcements"
        ]
      }
    ],
    completionMessage: "Excellent! You've completed the Manager walkthrough! You're ready to oversee projects, review bids, and coordinate your teams effectively."
  },

  ESTIMATOR: {
    role: "ESTIMATOR",
    roleName: "Estimator",
    welcomeMessage: "Welcome! As an Estimator, you'll create bids, set pricing, and build accurate project estimates. Let me walk you through the tools that will make your job easier.",
    steps: [
      {
        stepNumber: 1,
        title: "Creating Your First Bid",
        description: "Learn how to create a new bid from scratch, including project details and scope of work.",
        action: "Let's create a new bid. Navigate to Bids and click 'New Bid' to start.",
        targetPage: "/bids",
        tips: [
          "Start with the project basics: name, client, location",
          "Add detailed scope of work items",
          "Use the AI assistant to help identify missing items"
        ]
      },
      {
        stepNumber: 2,
        title: "Takeoff & Measurements",
        description: "Use the takeoff engine to measure drawings and calculate quantities.",
        action: "Open a bid and try the Takeoff tool to measure from project drawings.",
        targetPage: "/takeoff",
        tips: [
          "Upload PDF drawings to the takeoff engine",
          "Use linear, area, and count tools for measurements",
          "Save takeoff data directly to your bid"
        ]
      },
      {
        stepNumber: 3,
        title: "Setting Pricing & Rates",
        description: "Apply material costs, labor rates, and markups to create accurate estimates.",
        action: "Learn how to set unit prices, hourly rates, and profit margins.",
        targetPage: "/bids",
        tips: [
          "Use vendor catalog pricing for accuracy",
          "Factor in labor production rates",
          "Include overhead and profit margins"
        ]
      },
      {
        stepNumber: 4,
        title: "Adding Vendors to CRM",
        description: "Build your vendor database with suppliers, their catalogs, and current pricing.",
        action: "Add a vendor to your CRM with their material catalog and pricing.",
        targetPage: "/crm",
        tips: [
          "Add vendor contact information",
          "Input material pricing with unit costs",
          "Update pricing regularly for accuracy"
        ]
      },
      {
        stepNumber: 5,
        title: "Using Material Calculators",
        description: "Speed up estimating with built-in material calculators for your trade.",
        action: "Try the material calculators to quickly calculate quantities needed.",
        targetPage: "/calculators",
        tips: [
          "Enter dimensions to calculate material needs",
          "Calculators include waste factors",
          "Results can be added directly to bids"
        ]
      },
      {
        stepNumber: 6,
        title: "Generating Quotes",
        description: "Create professional PDF quotes to send to clients.",
        action: "Generate a quote document from a completed bid.",
        targetPage: "/bids",
        tips: [
          "Review the quote before generating PDF",
          "Choose internal summary or customer quote format",
          "Quotes are saved for easy access"
        ]
      }
    ],
    completionMessage: "Fantastic! You've completed the Estimator walkthrough! You now know how to create bids, perform takeoffs, set pricing, and generate quotes. Happy estimating!"
  },

  SUPERINTENDENT: {
    role: "SUPERINTENDENT",
    roleName: "Superintendent",
    welcomeMessage: "Welcome! As a Superintendent, you'll manage field operations, track daily progress, and coordinate crews. Let me show you the tools you'll use on the job.",
    steps: [
      {
        stepNumber: 1,
        title: "Your Assigned Projects",
        description: "View the projects you're supervising with all their details and schedules.",
        action: "Check your dashboard to see your assigned projects and their current status.",
        targetPage: "/dashboard",
        tips: [
          "Each project shows its timeline and milestones",
          "Review the project budget and actual costs",
          "Check crew assignments and equipment"
        ]
      },
      {
        stepNumber: 2,
        title: "Daily Field Reports",
        description: "Create daily reports to document work completed, weather, and any issues.",
        action: "Learn how to create a daily field report for one of your projects.",
        targetPage: "/daily-reports",
        tips: [
          "Log weather conditions at the start",
          "Document work completed by each crew",
          "Attach photos of progress and issues"
        ]
      },
      {
        stepNumber: 3,
        title: "Time & Material Tracking",
        description: "Track labor hours and materials used beyond the original scope.",
        action: "See how to log T&M (Time & Material) work on a project.",
        targetPage: "/t-and-m",
        tips: [
          "Log employee hours with descriptions",
          "Add material costs with receipts",
          "Get client signatures for approval"
        ]
      },
      {
        stepNumber: 4,
        title: "Documenting Delays",
        description: "Record project delays with reasons and supporting documentation.",
        action: "Learn how to create a delay report with photos and evidence.",
        targetPage: "/delays",
        tips: [
          "Select the reason for delay",
          "Upload photos and emails as proof",
          "Link delays to change orders for cost recovery"
        ]
      },
      {
        stepNumber: 5,
        title: "Crew Timeclock",
        description: "Manage crew clock-in/out and review timesheets.",
        action: "Check the timeclock system to see how crew hours are tracked.",
        targetPage: "/timeclock",
        tips: [
          "GPS location is captured at clock-in",
          "Review and approve timesheets weekly",
          "Flag any discrepancies for review"
        ]
      }
    ],
    completionMessage: "Great job! You've completed the Superintendent walkthrough! You're ready to manage field operations, track progress, and keep your projects running smoothly."
  },

  OFFICE_MANAGER: {
    role: "OFFICE_MANAGER",
    roleName: "Office Manager",
    welcomeMessage: "Welcome! As an Office Manager, you'll handle administrative tasks, billing, and supply ordering. Let me show you the key features you'll use daily.",
    steps: [
      {
        stepNumber: 1,
        title: "Your Dashboard",
        description: "Your dashboard shows pending administrative tasks, billing items, and team communications.",
        action: "Explore your dashboard to see pending invoices, supply orders, and action items.",
        targetPage: "/dashboard",
        tips: [
          "Check pending invoices regularly",
          "Review the calendar for important deadlines",
          "Monitor unread messages for urgent requests"
        ]
      },
      {
        stepNumber: 2,
        title: "Vendor & Supplier Management",
        description: "Manage your vendor relationships, pricing catalogs, and ordering.",
        action: "Navigate to the CRM section to see vendors, suppliers, and their contact information.",
        targetPage: "/crm",
        tips: [
          "Keep vendor contact info up to date",
          "Review pricing catalogs periodically",
          "Track preferred vendors for each material type"
        ]
      },
      {
        stepNumber: 3,
        title: "Billing & Invoicing",
        description: "Process invoices, track payments, and manage billing cycles.",
        action: "Learn how to view and process project billing and invoices.",
        targetPage: "/projects",
        tips: [
          "Track invoice due dates",
          "Document payment receipts",
          "Flag overdue accounts for follow-up"
        ]
      },
      {
        stepNumber: 4,
        title: "Team Communication",
        description: "Stay connected with the team and handle administrative requests.",
        action: "Check out the Messages section for internal communications.",
        targetPage: "/messages",
        tips: [
          "Respond to supply requests promptly",
          "Coordinate with superintendents on material needs",
          "Use company channel for office announcements"
        ]
      }
    ],
    completionMessage: "Great job! You've completed the Office Manager walkthrough! You're ready to handle billing, vendor management, and keep the office running smoothly."
  },

  HOURLY_EMPLOYEE: {
    role: "HOURLY_EMPLOYEE",
    roleName: "Field Worker",
    welcomeMessage: "Welcome to the team! As a field worker, you'll use this app to clock in/out and stay connected with your crew. Let me show you the basics.",
    steps: [
      {
        stepNumber: 1,
        title: "Clocking In",
        description: "Track your work hours by clocking in when you start your shift.",
        action: "Learn how to use the timeclock to clock in at the start of your day.",
        targetPage: "/timeclock",
        tips: [
          "Clock in when you arrive on site",
          "Make sure GPS location is enabled",
          "Select the correct project"
        ]
      },
      {
        stepNumber: 2,
        title: "Your Schedule",
        description: "See where you're assigned to work and your upcoming schedule.",
        action: "Check your dashboard to see your project assignments.",
        targetPage: "/dashboard",
        tips: [
          "View today's work assignment",
          "Check the calendar for upcoming days",
          "Note any schedule changes"
        ]
      },
      {
        stepNumber: 3,
        title: "Clocking Out",
        description: "End your shift by clocking out when your work day is done.",
        action: "Learn how to clock out at the end of your shift.",
        targetPage: "/timeclock",
        tips: [
          "Clock out before leaving the job site",
          "Review your hours for accuracy",
          "Report any issues to your foreman"
        ]
      }
    ],
    completionMessage: "You're all set! You've completed the basics walkthrough. Clock in, do great work, and clock out. Welcome to the team!"
  },

  MAINTENANCE_MANAGER: {
    role: "MAINTENANCE_MANAGER",
    roleName: "Maintenance Manager",
    welcomeMessage: "Welcome! As a Maintenance Manager, you'll oversee equipment maintenance, repairs, and fleet management. Let me show you the tools you'll use.",
    steps: [
      {
        stepNumber: 1,
        title: "Equipment Overview",
        description: "View all company equipment, their status, and maintenance schedules.",
        action: "Navigate to the Equipment section to see your fleet and tools inventory.",
        targetPage: "/equipment",
        tips: [
          "Review equipment status at a glance",
          "Check items due for maintenance",
          "Monitor equipment utilization"
        ]
      },
      {
        stepNumber: 2,
        title: "Maintenance Scheduling",
        description: "Set up preventative maintenance schedules for equipment.",
        action: "Learn how to create and manage maintenance schedules.",
        targetPage: "/equipment",
        tips: [
          "Schedule based on hours or calendar intervals",
          "Set up reminders for upcoming maintenance",
          "Track maintenance history"
        ]
      },
      {
        stepNumber: 3,
        title: "Repair Workflows",
        description: "Manage equipment repairs from report to completion.",
        action: "See how to track repair requests and manage the repair process.",
        targetPage: "/equipment",
        tips: [
          "Log repair issues as they're reported",
          "Track repair costs and parts",
          "Document repair completion"
        ]
      },
      {
        stepNumber: 4,
        title: "Hour Logging",
        description: "Track equipment usage hours for maintenance planning.",
        action: "Learn how to log and review equipment operating hours.",
        targetPage: "/equipment",
        tips: [
          "Regular hour updates improve maintenance timing",
          "Compare actual vs expected hours",
          "Use for depreciation tracking"
        ]
      },
      {
        stepNumber: 5,
        title: "Team Communication",
        description: "Coordinate with superintendents and crews on equipment needs.",
        action: "Check the Messages section for equipment-related requests.",
        targetPage: "/messages",
        tips: [
          "Respond to equipment requests promptly",
          "Coordinate rental needs with projects",
          "Report equipment availability"
        ]
      }
    ],
    completionMessage: "Excellent! You've completed the Maintenance Manager walkthrough. You're ready to manage equipment, schedule maintenance, and keep the fleet running!"
  }
};

// Get walkthrough for a specific role
export function getWalkthroughForRole(role: string): RoleWalkthrough | null {
  return ROLE_WALKTHROUGHS[role] || null;
}

// Get total steps for a role
export function getTotalStepsForRole(role: string): number {
  const walkthrough = ROLE_WALKTHROUGHS[role];
  return walkthrough ? walkthrough.steps.length : 0;
}

// Get specific step content
export function getWalkthroughStep(role: string, stepNumber: number): WalkthroughStep | null {
  const walkthrough = ROLE_WALKTHROUGHS[role];
  if (!walkthrough) return null;
  return walkthrough.steps.find(s => s.stepNumber === stepNumber) || null;
}

// Generate AI prompt for walkthrough assistance
export function generateWalkthroughPrompt(role: string, currentStep: number): string {
  const walkthrough = ROLE_WALKTHROUGHS[role];
  if (!walkthrough) return "";

  const step = walkthrough.steps.find(s => s.stepNumber === currentStep);
  if (!step) return "";

  return `You are helping a new ${walkthrough.roleName} learn to use the construction management platform.

Current Step: ${step.stepNumber} of ${walkthrough.steps.length} - "${step.title}"

Step Description: ${step.description}

What the user should do: ${step.action}

Tips for this step:
${step.tips.map(tip => `- ${tip}`).join('\n')}

Be encouraging and helpful. Guide them through this step in a conversational way. When they indicate they've completed the action, congratulate them and ask if they'd like to move to the next step.

If they have questions about this step, answer them clearly. If they're confused, offer to explain in simpler terms or provide an example.`;
}
