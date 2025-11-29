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

  FOREMAN: {
    role: "FOREMAN",
    roleName: "Foreman",
    welcomeMessage: "Welcome! As a Foreman, you lead your crew in the field and report on daily progress. Here's how to use the platform to stay organized.",
    steps: [
      {
        stepNumber: 1,
        title: "Your Crew & Assignments",
        description: "See your crew members and the projects you're assigned to.",
        action: "Check your dashboard to see your current project assignments.",
        targetPage: "/dashboard",
        tips: [
          "View who's on your crew today",
          "Check the work scheduled for the day",
          "Review safety requirements"
        ]
      },
      {
        stepNumber: 2,
        title: "Clocking In Your Crew",
        description: "Help your crew clock in and track their hours on the job.",
        action: "Learn how to use the timeclock for yourself and assist crew members.",
        targetPage: "/timeclock",
        tips: [
          "Clock in when you arrive on site",
          "Assign hours to the correct project",
          "Clock out at end of shift"
        ]
      },
      {
        stepNumber: 3,
        title: "Daily Progress Updates",
        description: "Report what your crew accomplished each day.",
        action: "See how to submit your crew's daily work summary.",
        targetPage: "/daily-reports",
        tips: [
          "Log completed work quantities",
          "Note any issues encountered",
          "Report equipment or material needs"
        ]
      },
      {
        stepNumber: 4,
        title: "Team Communication",
        description: "Stay in touch with superintendents and the office.",
        action: "Check your messages and learn how to send updates.",
        targetPage: "/messages",
        tips: [
          "Report urgent issues immediately",
          "Share photos of completed work",
          "Request materials or support"
        ]
      }
    ],
    completionMessage: "Awesome! You've completed the Foreman walkthrough! You're ready to lead your crew, track time, and report progress."
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

  SUBCONTRACTOR: {
    role: "SUBCONTRACTOR",
    roleName: "Subcontractor",
    welcomeMessage: "Welcome! As a Subcontractor partner, you'll have access to project information, submit invoices, and coordinate with project managers.",
    steps: [
      {
        stepNumber: 1,
        title: "Your Assigned Projects",
        description: "View the projects you're working on and your scope of work.",
        action: "Check your dashboard to see projects where you're assigned.",
        targetPage: "/dashboard",
        tips: [
          "Review your contract scope",
          "Check project schedules and milestones",
          "Contact the superintendent for coordination"
        ]
      },
      {
        stepNumber: 2,
        title: "Project Documents",
        description: "Access drawings, specifications, and other project documents.",
        action: "Learn how to find and download project documents.",
        targetPage: "/projects",
        tips: [
          "Download current drawings",
          "Check for addendums and changes",
          "Review RFIs and submittals"
        ]
      },
      {
        stepNumber: 3,
        title: "Communication",
        description: "Communicate with the project team and report issues.",
        action: "Use the messaging system to coordinate with the project manager.",
        targetPage: "/messages",
        tips: [
          "Report scheduling conflicts early",
          "Request information through the system",
          "Document all important communications"
        ]
      },
      {
        stepNumber: 4,
        title: "Invoice Submission",
        description: "Submit progress invoices for your completed work.",
        action: "Learn how to submit invoices for your contracted work.",
        targetPage: "/invoices",
        tips: [
          "Include all required documentation",
          "Match invoice to contract line items",
          "Track payment status"
        ]
      }
    ],
    completionMessage: "Excellent! You've completed the Subcontractor walkthrough. You're ready to access project info, communicate with the team, and submit invoices."
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
