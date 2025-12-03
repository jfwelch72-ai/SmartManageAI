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
        title: "Your Command Center",
        description: "{{firstName}}, this is your dashboard — think of it as mission control. You can see all organizations, user activity, and any issues that need attention from one central place.",
        action: "Take a look around! You'll see platform health metrics, active organizations, and anything flagged for your attention.",
        targetPage: "/dashboard",
        tips: [
          "Keep an eye on the key metrics — they tell you how the platform is doing",
          "Organizations that might need help will stand out here",
          "You can track how quickly new organizations are getting set up"
        ],
        encouragement: "Looking good, {{firstName}}! You've got a great view of everything from here."
      },
      {
        stepNumber: 2,
        title: "Managing Organizations",
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
        title: "Helping Users Out",
        description: "Sometimes users have questions I can't fully answer — that's when they come to you. This is where you'll see those escalated requests.",
        action: "Check out the support section to see how user issues are tracked and resolved.",
        targetPage: "/admin/support",
        tips: [
          "Issues I escalate will show up here automatically",
          "You can view things from a user's perspective if you need to troubleshoot",
          "Keep notes on common issues — they help everyone!"
        ],
        encouragement: "Perfect, {{firstName}}! You're all set to help users when they need that human touch."
      },
      {
        stepNumber: 4,
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
        stepNumber: 5,
        title: "System Settings",
        description: "Last stop! Here you can tweak platform-wide settings, update trade templates, and manage integrations.",
        action: "Take a peek at the settings. You probably won't change things often, but it's good to know where everything lives.",
        targetPage: "/admin/settings",
        tips: [
          "Trade templates can be updated as industry needs change",
          "Default settings affect all new organizations",
          "Integrations are managed here too"
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
        stepNumber: 6,
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
        stepNumber: 7,
        title: "Organize Your Crews",
        description: "Time to get organized! Group your field workers into crews, assign leaders, and know who's working where at all times.",
        action: "Navigate to Crews and set up your first crew. Add members, pick a crew lead, and you're set.",
        targetPage: "/crews",
        tips: [
          "Create crews based on how you actually work",
          "Every crew needs a lead to manage things",
          "Assign crews to specific projects",
          "Track productivity over time"
        ],
        encouragement: "Nice job organizing! Your field teams are going to love this."
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
        encouragement: "Almost done! Just one more step to go."
      },
      {
        stepNumber: 10,
        title: "We're a Team!",
        description: "Last thing, {{firstName}} — don't forget about me! I can help with tons of stuff: generating schedules, analyzing jobsite photos, creating change orders, answering questions. Just ask!",
        action: "See that little icon in the bottom right? That's me! Click it anytime you need help with anything.",
        targetPage: "/dashboard",
        tips: [
          "Ask me to generate project schedules",
          "Upload photos and I'll analyze them",
          "I can help draft change orders",
          "Stuck on something? Just ask — I'm here to help!"
        ],
        encouragement: "You made it, {{firstName}}! You're officially ready to rock."
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
        stepNumber: 4,
        title: "Handling Changes",
        description: "Scope changes happen, {{firstName}}. Here's where you manage them — additional work, billing adjustments, all the stuff that comes up mid-project.",
        action: "Check out how change orders work. You can create, review, and approve them right here.",
        targetPage: "/change-orders",
        tips: [
          "Document everything thoroughly — it protects you later",
          "Attach photos and supporting docs",
          "Track status from request to payment"
        ],
        encouragement: "Almost done! Just one more thing to show you."
      },
      {
        stepNumber: 5,
        title: "Staying Connected",
        description: "Last one, {{firstName}}! Keep your whole team on the same page with the messaging system. Way better than a million text threads.",
        action: "Check out Messages and see how you can communicate with estimators, supers, and crews.",
        targetPage: "/messages",
        tips: [
          "Set up project-specific channels",
          "Share documents and photos right in the conversation",
          "The company channel is great for announcements"
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
        title: "Building Your First Bid",
        description: "Alright {{firstName}}, let's dive in! Creating bids is what you do best, and this is where it all happens. You can build from scratch or let AI help analyze documents.",
        action: "Head to Bids and click 'New Bid'. Start with project details and scope of work — I'll help you along the way!",
        targetPage: "/bids",
        tips: [
          "Start with the basics: project name, client, location",
          "Break down the scope into detailed line items",
          "Psst — I can help identify items you might have missed!"
        ],
        encouragement: "Nice start, {{firstName}}! Bid creation is the heart of what we do here."
      },
      {
        stepNumber: 2,
        title: "Takeoffs Made Easy",
        description: "{{firstName}}, this is where it gets fun! Upload drawings and measure right on screen. Linear, area, count — whatever you need.",
        action: "Try out the Takeoff tool. Upload a PDF and start measuring. It's way faster than the old-school way!",
        targetPage: "/takeoff",
        tips: [
          "Drop in PDF drawings and they're ready to measure",
          "Use linear for lengths, area for surfaces, count for items",
          "All your takeoff data flows right into your bid"
        ],
        encouragement: "You've got the measuring tools down! This is going to save you so much time."
      },
      {
        stepNumber: 3,
        title: "Pricing It Right",
        description: "Now for the important part, {{firstName}} — getting the numbers right. Material costs, labor rates, overhead, profit. Let's make sure your bids are accurate AND profitable.",
        action: "Learn how to set unit prices and hourly rates. You can pull from vendor catalogs or set your own.",
        targetPage: "/bids",
        tips: [
          "Use vendor catalog pricing — it's already in the system",
          "Factor in realistic production rates",
          "Don't forget overhead and profit margins!"
        ],
        encouragement: "Now we're cooking! Accurate pricing = winning bids."
      },
      {
        stepNumber: 4,
        title: "Your Vendor Network",
        description: "{{firstName}}, your vendors are gold. Let's get their pricing in here so you can pull it right into your estimates.",
        action: "Pop into the CRM and add a vendor. Include their catalog and current pricing.",
        targetPage: "/crm",
        tips: [
          "Add contact info so you can reach them fast",
          "Input material pricing with unit costs",
          "Keep it updated — pricing changes!"
        ],
        encouragement: "Having vendor pricing at your fingertips is a game-changer."
      },
      {
        stepNumber: 5,
        title: "Calculator Magic",
        description: "Why do the math yourself when we've got calculators, {{firstName}}? Built-in calculators for your trade that already include waste factors.",
        action: "Try the material calculators. Punch in dimensions and watch the quantities appear.",
        targetPage: "/calculators",
        tips: [
          "Just enter dimensions — the calculator handles the rest",
          "Waste factors are already built in",
          "Add results straight to your bid"
        ],
        encouragement: "Almost there! One more thing to show you."
      },
      {
        stepNumber: 6,
        title: "Looking Professional",
        description: "Last step, {{firstName}}! When your bid is ready, generate a slick PDF quote to send to the client. Internal version or client-facing — you choose.",
        action: "Generate a quote document from a completed bid. It's just a click away!",
        targetPage: "/bids",
        tips: [
          "Always double-check before generating",
          "Pick internal summary or customer quote format",
          "Quotes are saved so you can find them later"
        ],
        encouragement: "And that's how you become an estimating machine, {{firstName}}!"
      }
    ],
    completionMessage: "You crushed it, {{firstName}}! You know how to create bids, do takeoffs, set pricing, and generate quotes. The estimating world is your oyster! I'm here whenever you need a hand — just click my icon. Now go win some bids!"
  },

  SUPERINTENDENT: {
    role: "SUPERINTENDENT",
    roleName: "Superintendent",
    welcomeMessage: "Hey {{firstName}}! Welcome to the field side of things. As a Superintendent, you're running the show out there — managing crews, tracking daily progress, and keeping projects on schedule. Let me show you the tools that'll make your life easier!",
    steps: [
      {
        stepNumber: 1,
        title: "Your Projects",
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
        stepNumber: 2,
        title: "Daily Reports",
        description: "This is where you document what's happening in the field, {{firstName}}. Work completed, weather, issues — it all goes here.",
        action: "Learn how to create a daily field report. It's quick and keeps everyone in the loop.",
        targetPage: "/daily-reports",
        tips: [
          "Start with weather conditions",
          "Log what each crew accomplished",
          "Attach photos of progress and any issues"
        ],
        encouragement: "Daily documentation is key! The office will love having this info."
      },
      {
        stepNumber: 3,
        title: "T&M Work",
        description: "Extra work comes up, {{firstName}} — that's just construction. Here's where you track time and materials beyond the original scope.",
        action: "See how to log T&M work. Hours, materials, client signatures — it's all here.",
        targetPage: "/t-and-m",
        tips: [
          "Log employee hours with what they worked on",
          "Add material costs with receipts",
          "Get that client signature for approval"
        ],
        encouragement: "Nice! Getting T&M documented right means you get paid for extra work."
      },
      {
        stepNumber: 4,
        title: "Documenting Delays",
        description: "Delays happen, {{firstName}}. The key is documenting them properly so the company can recover costs. This is where you do that.",
        action: "Learn how to create a delay report with photos and evidence.",
        targetPage: "/delays",
        tips: [
          "Pick the right reason for the delay",
          "Upload photos, emails, anything that supports it",
          "Link delays to change orders for cost recovery"
        ],
        encouragement: "Solid documentation protects the company. Good stuff!"
      },
      {
        stepNumber: 5,
        title: "Crew Time",
        description: "Last one, {{firstName}}! Here's where you manage your crew's clock-in and clock-out. GPS-tracked, easy to review.",
        action: "Check out the timeclock system to see how crew hours are tracked.",
        targetPage: "/timeclock",
        tips: [
          "GPS location is captured automatically at clock-in",
          "Review and approve timesheets each week",
          "Flag anything that looks off"
        ],
        encouragement: "And you're all set, {{firstName}}! You've got the field covered."
      }
    ],
    completionMessage: "You're ready to rock, {{firstName}}! Managing field operations, tracking progress, keeping projects on schedule — you've got all the tools. I'm here anytime you have questions. Just click my icon. Now get out there and crush it!"
  },

  OFFICE_MANAGER: {
    role: "OFFICE_MANAGER",
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

  HOURLY_EMPLOYEE: {
    role: "HOURLY_EMPLOYEE",
    roleName: "Field Worker",
    welcomeMessage: "Hey {{firstName}}! Welcome to the team! I'm here to help you get started. As a field worker, you've got a few simple things to know — clocking in, checking your schedule, and staying connected. Super easy, I promise!",
    steps: [
      {
        stepNumber: 1,
        title: "Clocking In",
        description: "First thing every day, {{firstName}} — clock in! It tracks your hours automatically and keeps everything organized.",
        action: "Check out the timeclock. When you arrive on site, you'll hit that clock-in button.",
        targetPage: "/timeclock",
        tips: [
          "Clock in when you get to the job site",
          "Make sure your GPS/location is on",
          "Pick the right project if you're asked"
        ],
        encouragement: "Easy right? That's literally the hardest part — and it's one button!"
      },
      {
        stepNumber: 2,
        title: "Your Schedule",
        description: "Want to know where you're working, {{firstName}}? Your dashboard shows you exactly what's coming up.",
        action: "Check out your dashboard to see today's assignment and what's ahead.",
        targetPage: "/dashboard",
        tips: [
          "Today's assignment is right there",
          "Check the calendar for upcoming days",
          "Keep an eye out for schedule changes"
        ],
        encouragement: "Nice! Now you always know where you need to be."
      },
      {
        stepNumber: 3,
        title: "Clocking Out",
        description: "End of the day, {{firstName}}! Clock out before you leave so your hours get counted correctly.",
        action: "Head back to the timeclock at the end of your shift and hit clock-out.",
        targetPage: "/timeclock",
        tips: [
          "Clock out before leaving the site",
          "Double-check your hours look right",
          "If something's off, let your foreman know"
        ],
        encouragement: "And that's it! You're officially a pro at this, {{firstName}}!"
      }
    ],
    completionMessage: "Welcome to the team, {{firstName}}! You've got the basics down — clock in, check your schedule, clock out. Simple as that! If you ever have questions, I'm right here. Just click my icon. Now go do great work!"
  },

  MAINTENANCE_MANAGER: {
    role: "MAINTENANCE_MANAGER",
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
        targetPage: "/dashboard",
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
        targetPage: "/vendor/catalog",
        tips: [
          "Keep pricing updated — contractors rely on it for accurate bids",
          "Add new products when they become available",
          "Mark discontinued items so nobody orders them"
        ],
        encouragement: "An accurate catalog means more orders for you!"
      },
      {
        stepNumber: 3,
        title: "Stay Connected",
        description: "Last thing, {{firstName}} — the messaging system keeps you in touch with your contractor partners. Quote requests, questions, delivery updates — it all flows through here.",
        action: "Check out Messages to see how you'll communicate with contractors.",
        targetPage: "/messages",
        tips: [
          "Quick responses to quote requests = happy contractors",
          "Answer pricing or availability questions here",
          "Keep them updated on delivery schedules"
        ],
        encouragement: "And you're all set! You're ready to rock as a Vendor Partner."
      }
    ],
    completionMessage: "You did it, {{firstName}}! Catalog management, communication, orders — you've got the tools to succeed. I'm here if you need anything. Just click my icon. Here's to a great partnership!"
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
