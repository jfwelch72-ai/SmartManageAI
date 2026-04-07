// Role-specific walkthrough content for new users
// Each role has a tailored set of steps to learn their key tasks
// Use {{firstName}} placeholder for personalization

export interface WalkthroughStep {
  stepNumber: number;
  title: string;
  description: string;
  action: string;
  targetPage: string;
  tips: string[];
  encouragement?: string; // Optional encouraging message when completing step
}

export interface RoleWalkthrough {
  role: string;
  roleName: string;
  welcomeMessage: string;
  steps: WalkthroughStep[];
  completionMessage: string;
}

// Helper function to personalize content with user's first name
export function personalizeContent(content: string, firstName: string): string {
  return content.replace(/\{\{firstName\}\}/g, firstName);
}

export const ROLE_WALKTHROUGHS: Record<string, RoleWalkthrough> = {
  SUPER_ADMIN: {
    role: "SUPER_ADMIN",
    roleName: "Platform Administrator",
    welcomeMessage: "Hey {{firstName}}! Welcome to the command center. As a Platform Administrator, you've got the keys to the whole kingdom — you can see everything happening across all organizations and help anyone who needs it. Ready to take a quick tour? I'll show you where all the important stuff is.",
    steps: [
      {
        stepNumber: 1,
        title: "Platform Command Center",
        description: "{{firstName}}, this is your dashboard — think of it as mission control. You can see all organizations, user activity, and any issues that need attention from one central place.",
        action: "Take a look around! You'll see platform health metrics, active organizations, and anything flagged for your attention.",
        targetPage: "/admin",
        tips: [
          "Keep an eye on the key metrics — they tell you how the platform is doing",
          "Organizations that might need help will stand out here",
          "You can track how quickly new organizations are getting set up"
        ],
        encouragement: "Looking good, {{firstName}}! You've got a great view of everything from here."
      },
      {
        stepNumber: 2,
        title: "Organization Management",
        description: "Here's where you can see all the contractors using the platform. Each one has their own setup, trade type, and team.",
        action: "Click through to the organization list — you'll see who's onboarded, who might need help, and how active each company is.",
        targetPage: "/admin/organizations",
        tips: [
          "Check onboarding progress to see who's still getting set up",
          "If someone's struggling with configuration, you can jump in and help",
          "Activity levels show you who's really using the platform"
        ],
        encouragement: "Nice work! Now you know where to find all the organizations."
      },
      {
        stepNumber: 3,
        title: "Platform Analytics",
        description: "Want to see how people are actually using the platform? This is the place. Charts, trends, feature adoption — it's all here.",
        action: "Explore the analytics dashboard. It'll show you what's popular, what's not getting much love, and overall trends.",
        targetPage: "/admin/analytics",
        tips: [
          "See which features different organizations use most",
          "Spot underused features that might need better promotion",
          "Performance metrics help catch issues before users notice"
        ],
        encouragement: "Awesome! Data nerd or not, these insights are super useful."
      },
      {
        stepNumber: 4,
        title: "Support Tools",
        description: "Last stop! Here you can manage platform-wide settings, update trade templates, handle integrations, and support users who need help.",
        action: "Take a peek at the support tools. You probably won't change things often, but it's good to know where everything lives.",
        targetPage: "/admin/tools",
        tips: [
          "Issues I escalate will show up here automatically",
          "Trade templates can be updated as industry needs change",
          "Default settings affect all new organizations"
        ],
        encouragement: "And that's the grand tour, {{firstName}}! You're officially ready to run this place."
      }
    ],
    completionMessage: "That's a wrap, {{firstName}}! You now know your way around the Platform Administrator tools. You've got full access to monitor and support everyone on the platform. Remember, I'm always here if you have questions — just click my icon anytime!"
  },

  ADMIN: {
    role: "ADMIN",
    roleName: "Administrator",
    welcomeMessage: "Hey {{firstName}}! Great to meet you! I'm your AI assistant, and I'll be here to help you every step of the way. As the Administrator, you're the boss — you've got full control over your organization's setup. Let's get your company up and running together!",
    steps: [
      {
        stepNumber: 1,
        title: "Let's Build Your Team",
        description: "First things first, {{firstName}} — let's get your people set up! Each team member gets their own login with access based on their role. Project Managers, Superintendents, Estimators, Field Workers — everyone gets exactly what they need.",
        action: "Head over to User Management and click 'Add User'. Pop in their details, pick their role, and they're good to go!",
        targetPage: "/users",
        tips: [
          "Start with your key players — your estimators, supers, and project managers",
          "Each role has specific permissions tailored to their job",
          "Don't worry — everyone gets their own guided walkthrough when they log in!",
          "You can set hourly rates for accurate job costing"
        ],
        encouragement: "Awesome, {{firstName}}! Getting the team in here is the first step to success."
      },
      {
        stepNumber: 2,
        title: "Your Dashboard — Home Base",
        description: "This is your command center, {{firstName}}! Everything important shows up right here — active projects, pending bids, messages, and all your key numbers at a glance.",
        action: "Take a minute to look around. See those widgets? Each one gives you quick insights and lets you dive deeper with a click.",
        targetPage: "/dashboard",
        tips: [
          "Click any widget to get more details",
          "The sidebar on the left is your gateway to everything",
          "Keep an eye on that notification bell!",
          "Remember, I'm always here in the bottom corner if you need me"
        ],
        encouragement: "You're getting the hang of this! This dashboard will become second nature."
      },
      {
        stepNumber: 3,
        title: "Build Your Network",
        description: "Your vendors, suppliers, and subs are the backbone of your business, {{firstName}}. Let's get them set up so you can pull their pricing right into your bids.",
        action: "Jump into the CRM section and start adding your key vendors. Their contact info, pricing catalogs, payment terms — everything in one place.",
        targetPage: "/crm",
        tips: [
          "Add vendors with their specialty and payment terms",
          "Import material pricing from quotes — saves tons of time",
          "Don't forget rental equipment vendors!",
          "Add subs you work with regularly"
        ],
        encouragement: "Nice! Having your network in here will make bidding so much faster."
      },
      {
        stepNumber: 4,
        title: "Track Your Equipment",
        description: "Got trucks, tools, heavy equipment? Let's get them tracked, {{firstName}}. You can assign them to projects, schedule maintenance, and know exactly where everything is.",
        action: "Check out the Equipment section and add your major pieces. Purchase dates, hours, maintenance schedules — the works.",
        targetPage: "/equipment",
        tips: [
          "Log equipment hours for accurate depreciation",
          "Set up maintenance reminders so nothing slips through",
          "Assign equipment to specific jobs",
          "Track repair history to spot problem equipment"
        ],
        encouragement: "Great stuff! Your fleet is officially in the system."
      },
      {
        stepNumber: 5,
        title: "Procurement",
        description: "Manage purchase orders, material requests, and vendor quotes, {{firstName}}. Streamline your procurement process from request to delivery.",
        action: "Check out the Procurement module to see how material ordering works.",
        targetPage: "/procurement-module",
        tips: [
          "Create purchase orders and track their status",
          "Compare vendor quotes for the best pricing",
          "Link material costs to specific projects",
          "Keep a paper trail for every purchase"
        ],
        encouragement: "Procurement is under control! No more chasing receipts."
      },
      {
        stepNumber: 6,
        title: "Create Your First Bid",
        description: "Alright {{firstName}}, here's where the magic happens! Bids are how you track potential work. Build detailed estimates with labor, materials, equipment, and overhead — I'll help you price it right.",
        action: "Head to Bids and click 'New Bid'. The Cost Builder will walk you through adding scope items and crunching the numbers.",
        targetPage: "/bids",
        tips: [
          "The Cost Builder makes bid creation step-by-step and easy",
          "Pull in vendor pricing directly from your CRM",
          "Don't forget overhead and profit margins!",
          "Generate professional PDF quotes for clients"
        ],
        encouragement: "Look at you go! You just learned the heart of the platform."
      },
      {
        stepNumber: 7,
        title: "Managing Projects",
        description: "When you win a bid (and you will!), it becomes a project. Here's where you track progress, handle change orders, and make sure you stay profitable.",
        action: "Browse the Projects section to see how work flows from winning a bid all the way to completion.",
        targetPage: "/projects",
        tips: [
          "Convert won bids into projects with one click",
          "Track status from planning through completion",
          "I can generate project schedules for you automatically!",
          "Daily logs keep everyone on the same page"
        ],
        encouragement: "You're halfway through, {{firstName}}! The big stuff is covered."
      },
      {
        stepNumber: 8,
        title: "Time Tracking Made Easy",
        description: "No more paper timesheets, {{firstName}}! Your team clocks in and out from their phones, and hours are automatically tied to the right projects.",
        action: "Check out the Time Clock to see how simple it is. Your crew will thank you.",
        targetPage: "/time-clock",
        tips: [
          "Employees clock in from any device",
          "Hours get linked to projects for accurate job costing",
          "Review and approve timesheets before payroll",
          "Overtime is tracked automatically"
        ],
        encouragement: "Payroll just got a whole lot easier!"
      },
      {
        stepNumber: 9,
        title: "CFO Dashboard",
        description: "This is your financial command center, {{firstName}}. Cash flow analysis, profitability trends, job costing breakdowns, and forecasting — all in one place.",
        action: "Head to the CFO Dashboard to see your financial analytics.",
        targetPage: "/cfo-dashboard",
        tips: [
          "Track cash flow across all projects",
          "Compare profitability by project or client",
          "Spot financial trends before they become problems",
          "Use forecasting to plan ahead"
        ],
        encouragement: "Now you've got the financial big picture!"
      },
      {
        stepNumber: 10,
        title: "Stay Connected",
        description: "Keep all your work communication in one place, {{firstName}}. No more scattered texts and emails — everything's here, secure and searchable.",
        action: "Head to Messages and see how team communication works. It's way better than group texts!",
        targetPage: "/messages",
        tips: [
          "Message anyone on your team directly",
          "Share project updates fast",
          "Everything stays organized by conversation",
          "Messages are private to your organization"
        ],
        encouragement: "And you're all set, {{firstName}}! You know everything you need."
      }
    ],
    completionMessage: "You did it, {{firstName}}! Your platform is all set up and ready to go. Your team members will each get their own guided tour when they log in. Start by adding more people, creating your first bid, or just explore! And hey — I'm always here if you need anything. Just click my icon anytime. Let's build something great together!"
  },

  MANAGER: {
    role: "MANAGER",
    roleName: "Project Manager",
    welcomeMessage: "Hey {{firstName}}! Welcome aboard! As a Project Manager, you're the glue that holds everything together — overseeing projects, reviewing bids, and keeping everyone coordinated. Let me show you around your workspace!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Home Base",
        description: "{{firstName}}, this is where you'll start each day. Your dashboard shows you everything that needs your attention — projects you're managing, approvals waiting for you, and team messages.",
        action: "Take a look around! Check out your assigned projects, upcoming deadlines, and any action items.",
        targetPage: "/dashboard",
        tips: [
          "I can help you generate tasks and schedules — just ask!",
          "The calendar shows all your project milestones",
          "Keep an eye on delay alerts — early warning saves headaches"
        ],
        encouragement: "Nice! This will be your go-to spot every morning."
      },
      {
        stepNumber: 2,
        title: "Reviewing Bids",
        description: "Your estimators send bids here for you to review, {{firstName}}. Check the pricing, make sure margins look good, and approve them to go to clients.",
        action: "Head to Bids and check out how the review and approval process works.",
        targetPage: "/bids",
        tips: [
          "Always check the cost breakdown and profit margins",
          "Verify vendor pricing looks right",
          "Add notes when you approve or send back for changes"
        ],
        encouragement: "You're the quality control here — nice work learning the ropes!"
      },
      {
        stepNumber: 3,
        title: "CRM & Vendors",
        description: "Your vendors, clients, and subs are all here, {{firstName}}. Manage your business relationships with contact info and pricing catalogs.",
        action: "Jump into the CRM to see your network of contacts and vendors.",
        targetPage: "/crm",
        tips: [
          "Keep contact info and pricing current",
          "Note preferred vendors for each material type",
          "Track relationship history with each contact"
        ],
        encouragement: "Organized relationships make everything run smoother!"
      },
      {
        stepNumber: 4,
        title: "Running Projects",
        description: "Here's where you track everything happening on active jobs, {{firstName}}. Progress, change orders, field reports, budgets — it's all here.",
        action: "Open up a project and explore. You'll see schedules, daily reports, and all the financials.",
        targetPage: "/projects",
        tips: [
          "Review daily field reports from your supers",
          "Keep tabs on labor hours and material costs",
          "Don't let change orders sit — process them quickly"
        ],
        encouragement: "You've got a great view of what's happening in the field now!"
      },
      {
        stepNumber: 5,
        title: "Time Approval",
        description: "Review and approve crew time entries, {{firstName}}. Ensure accurate labor tracking for job costing.",
        action: "Head to Manage Time Clock to see how time approval works.",
        targetPage: "/time-clock-manager",
        tips: [
          "Review entries before payroll runs",
          "Catch discrepancies early",
          "Hours are automatically linked to projects"
        ],
        encouragement: "Accurate time = accurate job costing. Nice work!"
      },
      {
        stepNumber: 6,
        title: "CFO Dashboard",
        description: "Financial analysis at your fingertips, {{firstName}} — cash flow, profitability trends, and job costing breakdowns.",
        action: "Check out the CFO Dashboard for your financial overview.",
        targetPage: "/cfo-dashboard",
        tips: [
          "Track cash flow across your projects",
          "Compare profitability by project or client",
          "Use financial insights to make better decisions"
        ],
        encouragement: "Now you've got the financial big picture!"
      },
      {
        stepNumber: 7,
        title: "Messages",
        description: "Keep your whole team on the same page, {{firstName}}. Way better than a million text threads.",
        action: "Check out Messages and see how you can communicate with estimators, supers, and crews.",
        targetPage: "/messages",
        tips: [
          "Share documents and photos right in the conversation",
          "Coordinate with your entire team in one place",
          "The company channel is great for announcements"
        ],
        encouragement: "Almost done! Just one more to go."
      },
      {
        stepNumber: 8,
        title: "Crew Management",
        description: "Last one, {{firstName}}! Organize your workforce into crews, assign foremen, and track who's working where.",
        action: "Navigate to Crews to see how team organization works.",
        targetPage: "/crews",
        tips: [
          "Create crews based on how you actually work",
          "Every crew needs a lead to manage things",
          "Assign crews to specific projects"
        ],
        encouragement: "And that's a wrap! You're ready to manage like a pro."
      }
    ],
    completionMessage: "Fantastic work, {{firstName}}! You're all set to oversee projects, review bids, and keep your teams running smoothly. I'm always here if you need help — just click my icon anytime!"
  },

  ESTIMATOR: {
    role: "ESTIMATOR",
    roleName: "Estimator",
    welcomeMessage: "Hey {{firstName}}! You're in the right place. As an Estimator, you're going to love the tools we've got here — creating bids, analyzing drawings, pulling vendor pricing. Let me show you how to work your magic!",
    steps: [
      {
        stepNumber: 1,
        title: "Estimator Dashboard",
        description: "{{firstName}}, this is your home base. You'll see bids requiring estimates, your workload, and upcoming bid deadlines at a glance.",
        action: "Take a look around your dashboard to see what needs your attention.",
        targetPage: "/dashboard",
        tips: [
          "Never miss a bid deadline with clear visibility",
          "See which bids need your estimates",
          "Track your workload and priorities"
        ],
        encouragement: "Nice! This will be your go-to spot every morning."
      },
      {
        stepNumber: 2,
        title: "Bid Pipeline",
        description: "Alright {{firstName}}, let's dive in! Creating bids is what you do best, and this is where it all happens. Access all active bids, start new estimates, or continue working on existing ones.",
        action: "Head to Bids and check out the pipeline. You can build from scratch or let AI help analyze documents!",
        targetPage: "/bids",
        tips: [
          "Start with the basics: project name, client, location",
          "Break down the scope into detailed line items",
          "Psst — I can help identify items you might have missed!"
        ],
        encouragement: "Nice start, {{firstName}}! Bid creation is the heart of what we do here."
      },
      {
        stepNumber: 3,
        title: "Bid Network",
        description: "Find and connect with subcontractors for your bids, {{firstName}}. Send bid invitations and receive competitive quotes from your network.",
        action: "Check out the Bid Network to see how sub bidding works.",
        targetPage: "/bid-network",
        tips: [
          "Send bid invitations to multiple subs at once",
          "Compare quotes side-by-side",
          "Build a network of reliable subcontractors"
        ],
        encouragement: "More competitive sub quotes mean better margins on your estimates!"
      },
      {
        stepNumber: 4,
        title: "Scope of Work Library",
        description: "{{firstName}}, your trade-specific scope items live here — standard units, labor rates, and material costs. This is how you build estimates faster.",
        action: "Check out Scope Settings to see your scope item library.",
        targetPage: "/scope-settings",
        tips: [
          "Standardized scope items ensure consistent pricing",
          "Reuse scope items across multiple bids",
          "Keep your library updated as rates change"
        ],
        encouragement: "Having a solid scope library is a game-changer for speed!"
      },
      {
        stepNumber: 5,
        title: "Historical Production Data",
        description: "Want to know how long things really take, {{firstName}}? See actual production rates from completed work right here.",
        action: "Check out Production Rates to see real-world performance data.",
        targetPage: "/production-rates",
        tips: [
          "Compare estimated vs actual performance",
          "Use real data to price future work accurately",
          "Spot trends in productivity over time"
        ],
        encouragement: "Real data beats guesswork — price with confidence!"
      },
      {
        stepNumber: 6,
        title: "Cost Rates",
        description: "Access current cost rates for labor and materials, {{firstName}}. Keeping these up to date is key to accurate estimates.",
        action: "Check out Cost Rates to see your current pricing.",
        targetPage: "/cost-rates",
        tips: [
          "Update rates regularly for accurate bids",
          "Track how costs change over time",
          "Up-to-date pricing prevents costly estimating errors"
        ],
        encouragement: "Almost there! One more thing to show you."
      },
      {
        stepNumber: 7,
        title: "Trade Calculator",
        description: "Last step, {{firstName}}! Built-in calculators for your trade with waste factors already included. Punch in dimensions and get accurate quantities.",
        action: "Try the material calculators. Enter dimensions and watch the quantities appear.",
        targetPage: "/calculator",
        tips: [
          "Just enter dimensions — the calculator handles the rest",
          "Waste factors are already built in",
          "Add results straight to your bid"
        ],
        encouragement: "And that's how you become an estimating machine, {{firstName}}!"
      }
    ],
    completionMessage: "You crushed it, {{firstName}}! You know how to navigate bids, use the bid network, scope library, production data, cost rates, and calculators. The estimating world is your oyster! I'm here whenever you need a hand — just click my icon. Now go win some bids!"
  },

  SUPERINTENDENT: {
    role: "SUPERINTENDENT",
    roleName: "Superintendent",
    welcomeMessage: "Hey {{firstName}}! Welcome to the field side of things. As a Superintendent, you're running the show out there — managing crews, tracking daily progress, and keeping projects on schedule. Let me show you the tools that'll make your life easier!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Time Clock",
        description: "First thing every day, {{firstName}} — clock in! It tracks your hours automatically and shows you're on the jobsite.",
        action: "Check out the time clock. When you arrive on site, hit that clock-in button.",
        targetPage: "/time-clock",
        tips: [
          "Clock in when you get to the job site",
          "Make sure your GPS/location is on",
          "Leading by example sets the standard for your crew"
        ],
        encouragement: "Easy right? Leading by example starts with clocking in!"
      },
      {
        stepNumber: 2,
        title: "Your Dashboard",
        description: "{{firstName}}, this is your home base. You'll see all the projects you're supervising, their timelines, and where things stand.",
        action: "Check out your dashboard. You'll see your assigned projects and their current status at a glance.",
        targetPage: "/dashboard",
        tips: [
          "Each project shows its timeline and key milestones",
          "Keep an eye on budget vs. actual costs",
          "Check which crews and equipment are assigned where"
        ],
        encouragement: "Looking good! You've got a bird's eye view of everything you're running."
      },
      {
        stepNumber: 3,
        title: "Manage Crew Time",
        description: "Here's where you manage your crew's clock-in and clock-out, {{firstName}}. GPS-tracked hours linked to the right projects for accurate job costing.",
        action: "Check out the Manage Time Clock to see how crew hour approval works.",
        targetPage: "/time-clock-manager",
        tips: [
          "GPS location is captured automatically at clock-in",
          "Review and approve timesheets each week",
          "Flag anything that looks off"
        ],
        encouragement: "Catching time issues early prevents payroll headaches!"
      },
      {
        stepNumber: 4,
        title: "Project Management",
        description: "Track everything happening on your active jobs, {{firstName}}. Progress, daily reports, change orders, budgets — it's all here.",
        action: "Open up a project and explore. You'll see schedules, daily reports, and scope details.",
        targetPage: "/projects",
        tips: [
          "Log daily field reports to keep the office informed",
          "Track crew accomplishments and any issues",
          "Don't let change orders sit — process them quickly"
        ],
        encouragement: "You've got a great view of what's happening in the field now!"
      },
      {
        stepNumber: 5,
        title: "Approvals",
        description: "Review and approve daily reports, time entries, and change orders that need your sign-off, {{firstName}}.",
        action: "Check out the Approvals section to see what needs your attention.",
        targetPage: "/approvals",
        tips: [
          "Stay on top of pending approvals",
          "Quick approvals keep the project moving",
          "Document your decisions for the record"
        ],
        encouragement: "Nice! Keeping approvals current keeps the project on track."
      },
      {
        stepNumber: 6,
        title: "Equipment",
        description: "See which equipment is assigned to your jobsites, check availability, and request what you need, {{firstName}}.",
        action: "Check out the Equipment section to see what's available.",
        targetPage: "/equipment",
        tips: [
          "See what's assigned to your projects",
          "Request equipment you need for upcoming work",
          "Report any equipment issues right away"
        ],
        encouragement: "Having the right equipment on site keeps production on track!"
      },
      {
        stepNumber: 7,
        title: "Procurement",
        description: "Last one, {{firstName}}! Submit material requests and track purchase orders for your projects. Get what you need without delays.",
        action: "Check out Procurement to see how material ordering works.",
        targetPage: "/procurement-module",
        tips: [
          "Submit material requests for your projects",
          "Track order status from request to delivery",
          "Keep a paper trail for every purchase"
        ],
        encouragement: "And you're all set, {{firstName}}! You've got the field covered."
      }
    ],
    completionMessage: "You're ready to rock, {{firstName}}! Managing field operations, tracking progress, keeping projects on schedule — you've got all the tools. I'm here anytime you have questions. Just click my icon. Now get out there and crush it!"
  },

  _OFFICE_MANAGER_LEGACY: {
    role: "MANAGER",
    roleName: "Office Manager",
    welcomeMessage: "Hey {{firstName}}! Welcome to your workspace. As Office Manager, you're the one keeping everything running smoothly behind the scenes — billing, vendors, supplies, coordination. Let me show you around!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Home Base",
        description: "{{firstName}}, this is where you'll start each day. Your dashboard shows what needs attention — pending invoices, supply requests, and messages from the team.",
        action: "Take a look around. You'll see pending invoices, supply orders, and action items at a glance.",
        targetPage: "/dashboard",
        tips: [
          "Check pending invoices regularly — don't let them pile up",
          "The calendar shows important deadlines",
          "Unread messages might have urgent requests"
        ],
        encouragement: "Nice! This dashboard is going to be your best friend."
      },
      {
        stepNumber: 2,
        title: "Managing Vendors",
        description: "Your vendors and suppliers are all in one place, {{firstName}}. Contact info, pricing, everything you need for ordering.",
        action: "Jump into the CRM to see your vendors, suppliers, and their details.",
        targetPage: "/crm",
        tips: [
          "Keep contact info current",
          "Check pricing catalogs periodically — things change!",
          "Note your preferred vendors for each type of material"
        ],
        encouragement: "Having all this organized makes ordering so much easier!"
      },
      {
        stepNumber: 3,
        title: "Billing & Invoices",
        description: "Money matters! Here's where you process invoices, track payments, and stay on top of billing, {{firstName}}.",
        action: "Learn how to view and process project billing and invoices.",
        targetPage: "/projects",
        tips: [
          "Keep an eye on invoice due dates",
          "Document payment receipts",
          "Flag overdue accounts so nothing slips"
        ],
        encouragement: "Getting billing right keeps the whole company healthy!"
      },
      {
        stepNumber: 4,
        title: "Staying Connected",
        description: "Last thing, {{firstName}} — the messaging system keeps you connected with everyone. Supply requests, field questions, office announcements — it all flows through here.",
        action: "Check out Messages to see how internal communications work.",
        targetPage: "/messages",
        tips: [
          "Respond to supply requests quickly — the field needs their stuff!",
          "Coordinate with supers on material needs",
          "Use the company channel for office announcements"
        ],
        encouragement: "And you're all set! You've got the office under control."
      }
    ],
    completionMessage: "You did it, {{firstName}}! Billing, vendors, coordination — you've got it all covered. The office is in good hands! I'm here whenever you need help. Just click my icon anytime!"
  },

  FIELD_WORKER: {
    role: "FIELD_WORKER",
    roleName: "Field Worker",
    welcomeMessage: "Hey {{firstName}}! Welcome to the team! I'm here to help you get started. As a field worker, you've got a few simple things to know — clocking in, checking your schedule, and staying connected. Super easy, I promise!",
    steps: [
      {
        stepNumber: 1,
        title: "Clocking In",
        description: "First thing every day, {{firstName}} — clock in! It tracks your hours automatically and keeps everything organized.",
        action: "Check out the timeclock. When you arrive on site, you'll hit that clock-in button.",
        targetPage: "/time-clock",
        tips: [
          "Clock in when you get to the job site",
          "Make sure your GPS/location is on",
          "Pick the right project if you're asked"
        ],
        encouragement: "Easy right? That's literally the hardest part — and it's one button!"
      },
      {
        stepNumber: 2,
        title: "Your Tasks",
        description: "View tasks assigned to you, {{firstName}}. Mark them complete and add notes about your work.",
        action: "Check out the Tasks section to see what's been assigned to you.",
        targetPage: "/tasks",
        tips: [
          "Check your tasks at the start of each day",
          "Mark tasks complete when you finish them",
          "Add notes if there's anything to report"
        ],
        encouragement: "Clear task lists keep the job moving forward!"
      },
      {
        stepNumber: 3,
        title: "Your Schedule",
        description: "Want to know where you're working, {{firstName}}? Your calendar shows you exactly what's coming up.",
        action: "Check out the calendar to see today's assignment and what's ahead.",
        targetPage: "/calendar",
        tips: [
          "Today's assignment is right there",
          "Check the calendar for upcoming days",
          "Keep an eye out for schedule changes"
        ],
        encouragement: "Nice! Now you always know where you need to be."
      },
      {
        stepNumber: 4,
        title: "Bulletins & Communications",
        description: "Stay in the loop, {{firstName}}! Company announcements, safety updates, and important notices from the office all show up here.",
        action: "Check out the Bulletins section for the latest company news.",
        targetPage: "/communications",
        tips: [
          "Read safety bulletins — they keep you safe on the job",
          "Check for schedule or policy updates",
          "Important announcements are highlighted"
        ],
        encouragement: "Staying informed is key to being a great team member!"
      },
      {
        stepNumber: 5,
        title: "Your Dashboard",
        description: "Last one, {{firstName}}! Your dashboard shows your assigned projects and important info at a glance.",
        action: "Check out your dashboard to see the big picture.",
        targetPage: "/dashboard",
        tips: [
          "Your assigned projects are listed here",
          "Check for any updates or announcements",
          "If something's off, let your foreman know"
        ],
        encouragement: "And that's it! You're officially a pro at this, {{firstName}}!"
      }
    ],
    completionMessage: "Welcome to the team, {{firstName}}! You've got the basics down — clock in, check your tasks and schedule, stay informed with bulletins. Simple as that! If you ever have questions, I'm right here. Just click my icon. Now go do great work!"
  },

  _MAINTENANCE_MANAGER_LEGACY: {
    role: "FIELD_WORKER",
    roleName: "Maintenance Manager",
    welcomeMessage: "Hey {{firstName}}! Great to have you here. As Maintenance Manager, you're in charge of keeping everything running — equipment, vehicles, tools. Let me show you how to stay on top of it all!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Fleet Overview",
        description: "{{firstName}}, this is your command center for all equipment. You'll see everything the company owns, its status, and what needs attention.",
        action: "Head to the Equipment section and check out your fleet and tools inventory.",
        targetPage: "/equipment",
        tips: [
          "Equipment status tells you what's working, what's not",
          "Items due for maintenance are flagged",
          "See which equipment is being used the most"
        ],
        encouragement: "Nice! You've got eyes on everything now."
      },
      {
        stepNumber: 2,
        title: "Scheduling Maintenance",
        description: "Prevention beats repair, {{firstName}}! Here's where you set up maintenance schedules so nothing breaks down unexpectedly.",
        action: "Learn how to create and manage preventative maintenance schedules.",
        targetPage: "/equipment",
        tips: [
          "Schedule by hours used or by calendar (your choice)",
          "Set reminders so nothing gets forgotten",
          "Track all maintenance history"
        ],
        encouragement: "Smart scheduling saves money and headaches!"
      },
      {
        stepNumber: 3,
        title: "Handling Repairs",
        description: "When something breaks, {{firstName}}, here's where you manage it — from the first report to getting it back in service.",
        action: "See how repair requests are tracked and how to manage the process.",
        targetPage: "/equipment",
        tips: [
          "Log issues as soon as they're reported",
          "Track what repairs cost and what parts were used",
          "Document when it's fixed and back in service"
        ],
        encouragement: "Great! You've got the repair workflow down."
      },
      {
        stepNumber: 4,
        title: "Tracking Hours",
        description: "Equipment hours, {{firstName}} — they're key to knowing when maintenance is due and tracking depreciation.",
        action: "Learn how to log and review equipment operating hours.",
        targetPage: "/equipment",
        tips: [
          "Regular hour updates = better maintenance timing",
          "Compare actual vs. expected hours",
          "Useful for depreciation tracking too"
        ],
        encouragement: "Hours logged means better planning. Nice work!"
      },
      {
        stepNumber: 5,
        title: "Coordination",
        description: "Last one, {{firstName}}! Stay connected with the field — equipment requests, rental needs, availability updates all flow through Messages.",
        action: "Check out the Messages section to see how coordination works.",
        targetPage: "/messages",
        tips: [
          "Respond to equipment requests quickly",
          "Coordinate rentals with project needs",
          "Keep everyone updated on what's available"
        ],
        encouragement: "And you're all set! Your fleet is in good hands."
      }
    ],
    completionMessage: "You're ready to roll, {{firstName}}! Equipment management, maintenance scheduling, repairs — you've got it all. I'm here if you need anything. Just click my icon anytime. Keep that fleet running smooth!"
  },

  VENDOR: {
    role: "VENDOR",
    roleName: "Vendor Partner",
    welcomeMessage: "Hey {{firstName}}! Welcome to the vendor portal! As a Vendor Partner, you've got a direct line to your contractor partners — update pricing, see orders, and stay connected. Let me give you a quick tour!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Dashboard",
        description: "{{firstName}}, this is your home base. You'll see your partnership status, recent orders, and anything that needs your attention.",
        action: "Take a look around! Check out your active partnerships and recent activity.",
        targetPage: "/vendor",
        tips: [
          "Recent transactions are right at the top",
          "Watch for pending quote requests",
          "Your partnership status shows how things are going"
        ],
        encouragement: "Nice! You've got a great view of your contractor relationships."
      },
      {
        stepNumber: 2,
        title: "Your Product Catalog",
        description: "This is the good stuff, {{firstName}} — your products and pricing. Contractors see this when they're building estimates.",
        action: "Head to your catalog and make sure your products and prices are current.",
        targetPage: "/vendor/pricing",
        tips: [
          "Keep pricing updated — contractors rely on it for accurate bids",
          "Add new products when they become available",
          "Mark discontinued items so nobody orders them"
        ],
        encouragement: "An accurate catalog means more orders for you!"
      },
      {
        stepNumber: 3,
        title: "Your Clients",
        description: "See which contractors are using your pricing and manage your relationships, {{firstName}}.",
        action: "Check out the Clients section to see your enrolled contractor partners.",
        targetPage: "/vendor/clients",
        tips: [
          "See which contractors have enrolled for your pricing",
          "Track your active relationships",
          "Know your customers to provide better service"
        ],
        encouragement: "Great partnerships are built on knowing your customers!"
      },
      {
        stepNumber: 4,
        title: "Messages",
        description: "Communicate directly with your contractor partners, {{firstName}}. Answer questions, send quotes, and coordinate deliveries.",
        action: "Check out Messages to see how you'll communicate with contractors.",
        targetPage: "/vendor/messages",
        tips: [
          "Quick responses to quote requests = happy contractors",
          "Answer pricing or availability questions here",
          "Keep them updated on delivery schedules"
        ],
        encouragement: "Fast communication builds trust with your partners!"
      },
      {
        stepNumber: 5,
        title: "Bid Inbox",
        description: "Last one, {{firstName}}! Receive bid invitations from contractors. Review project details and submit your competitive quotes.",
        action: "Check out the Bid Inbox to see incoming bid requests.",
        targetPage: "/bid-network-inbox",
        tips: [
          "Respond quickly to bid invitations",
          "Review project scope before quoting",
          "More bids = more business opportunities"
        ],
        encouragement: "And you're all set! You're ready to rock as a Vendor Partner."
      }
    ],
    completionMessage: "You did it, {{firstName}}! Pricing, client management, messages, and bid invitations — you've got all the tools to succeed. I'm here if you need anything. Just click my icon. Here's to a great partnership!"
  },

  HUSTLER: {
    role: "HUSTLER",
    roleName: "Multi-Organization Manager",
    welcomeMessage: "Hey {{firstName}}! Welcome to your Hustler command center! As a Multi-Organization Manager, you've got the power to oversee multiple companies from one account. Let me show you how to navigate your empire!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Portfolio",
        description: "{{firstName}}, this is where you see all your linked organizations at a glance. Switch between companies and manage your entire business portfolio.",
        action: "Check out the Portfolio section in the sidebar to see your companies.",
        targetPage: "/hustler",
        tips: [
          "See all your linked organizations in one view",
          "Switch between companies with one click",
          "Track performance across your entire portfolio"
        ],
        encouragement: "Nice! You've got the keys to your entire empire right here."
      },
      {
        stepNumber: 2,
        title: "Executive Dashboard",
        description: "This is your command center, {{firstName}}. See aggregated metrics across all your organizations — performance comparisons and key numbers.",
        action: "Check out your dashboard and see the big picture.",
        targetPage: "/dashboard",
        tips: [
          "Dashboard stats reflect the organization you're currently viewing",
          "Use the organization switcher to jump between companies",
          "Keep an eye on key metrics across all your businesses"
        ],
        encouragement: "You're already getting the hang of managing multiple orgs!"
      },
      {
        stepNumber: 3,
        title: "CFO Analytics",
        description: "Deep financial analysis across your portfolio, {{firstName}} — cash flow, profitability trends, and financial forecasting.",
        action: "Head to the CFO Dashboard for your financial overview.",
        targetPage: "/cfo-dashboard",
        tips: [
          "Track cash flow across all your companies",
          "Compare profitability by organization",
          "Use forecasting to plan strategic investments"
        ],
        encouragement: "Data-driven decisions about where to invest and where to cut!"
      },
      {
        stepNumber: 4,
        title: "Cross-Org Projects",
        description: "{{firstName}}, you can view projects across all your organizations. This helps you track work happening across your entire portfolio.",
        action: "Check out the Projects section to see work across your organizations.",
        targetPage: "/projects",
        tips: [
          "Remember to switch organizations to see each company's projects",
          "Use this view to spot patterns across companies",
          "Compare how different teams handle similar projects"
        ],
        encouragement: "Great overview! You're seeing the bigger picture."
      },
      {
        stepNumber: 5,
        title: "COO Delegation",
        description: "Last thing, {{firstName}} — assign COO-level access to trusted managers who can help oversee operations across organizations.",
        action: "Head to User Management to see how delegation works.",
        targetPage: "/users",
        tips: [
          "Assign trusted managers to help oversee operations",
          "Scale your oversight without being in every meeting",
          "Each person gets role-appropriate access"
        ],
        encouragement: "And you're ready to hustle! Multiple orgs, one powerful account."
      }
    ],
    completionMessage: "You're set up and ready to roll, {{firstName}}! Managing multiple organizations is no small feat, but you've got all the tools you need. I'm here if you need anything — just click my icon. Go build your empire!"
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

// Generate AI prompt for walkthrough assistance with personalization
export function generateWalkthroughPrompt(role: string, currentStep: number, firstName?: string): string {
  const walkthrough = ROLE_WALKTHROUGHS[role];
  if (!walkthrough) return "";

  const step = walkthrough.steps.find(s => s.stepNumber === currentStep);
  if (!step) return "";

  const name = firstName || "there";
  const personalizedDescription = personalizeContent(step.description, name);
  const personalizedAction = personalizeContent(step.action, name);
  const personalizedEncouragement = step.encouragement ? personalizeContent(step.encouragement, name) : "";

  return `You are a friendly AI assistant helping ${name}, a new ${walkthrough.roleName}, learn to use the construction management platform.

IMPORTANT: Address the user by their first name "${name}" naturally in your responses to create a personal connection.

Current Step: ${step.stepNumber} of ${walkthrough.steps.length} - "${step.title}"

Step Context: ${personalizedDescription}

What ${name} should do: ${personalizedAction}

Tips for this step:
${step.tips.map(tip => `- ${tip}`).join('\n')}

${personalizedEncouragement ? `Encouragement when they complete this step: ${personalizedEncouragement}` : ""}

CONVERSATION STYLE:
- Be warm, friendly, and conversational — like a helpful coworker
- Use ${name}'s first name naturally (not every sentence, but regularly)
- Be encouraging and celebrate small wins
- If they ask questions, answer in plain language without jargon
- If they seem confused, offer simpler explanations or examples
- When they complete the step, congratulate them genuinely and offer to move to the next step
- If they want to skip ahead or go back, be flexible and supportive
- If they ask about features beyond this step, briefly answer and gently guide back to the current step

Remember: You're ${name}'s guide through this platform. Make them feel supported and confident!`;
}

// Get personalized walkthrough content for a user
export function getPersonalizedWalkthrough(role: string, firstName: string): RoleWalkthrough | null {
  const walkthrough = ROLE_WALKTHROUGHS[role];
  if (!walkthrough) return null;

  return {
    ...walkthrough,
    welcomeMessage: personalizeContent(walkthrough.welcomeMessage, firstName),
    completionMessage: personalizeContent(walkthrough.completionMessage, firstName),
    steps: walkthrough.steps.map(step => ({
      ...step,
      description: personalizeContent(step.description, firstName),
      action: personalizeContent(step.action, firstName),
      encouragement: step.encouragement ? personalizeContent(step.encouragement, firstName) : undefined,
    })),
  };
}
