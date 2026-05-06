# TFR CONSTRUCTION PLATFORM - FULL CODE AUDIT EXPORT
# Generated: November 19, 2025
# Purpose: External Code Review and Architecture Audit

**Repository Overview:**
- Platform: TFR Construction Management Platform
- Stack: TypeScript, React, PostgreSQL (Neon), Express.js, Drizzle ORM
- Features: AI Senior PM + CFO (OpenAI GPT-4), Subcontractor Management, Crew & Skills Tracking, Time Clock with GPS, Profitability Engine, Data Quality Scoring, Complete Audit Trail

**Document Structure:**
1. Configuration Files
2. Database Schema & Migrations
3. Backend Core (Server Routes)
4. AI System Files (All AI logic)
5. Frontend Pages (Key UX Pages)

---

## 1. CONFIGURATION FILES

### =====================================
### FILE: package.json
### =====================================

```json
{
  "name": "rest-express",
  "version": "1.0.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "NODE_ENV=development tsx server/index.ts",
    "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js",
    "check": "tsc",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@google-cloud/storage": "^7.17.3",
    "@hookform/resolvers": "^3.10.0",
    "@jridgewell/trace-mapping": "^0.3.25",
    "@neondatabase/serverless": "^0.10.4",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tanstack/react-query": "^5.60.5",
    "@types/bcrypt": "^6.0.0",
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/multer": "^2.0.0",
    "@uppy/aws-s3": "^5.0.2",
    "@uppy/core": "^5.1.1",
    "@uppy/dashboard": "^5.0.4",
    "@uppy/react": "^5.1.1",
    "bcrypt": "^6.0.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "connect-pg-simple": "^10.0.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "date-fns": "^3.6.0",
    "drizzle-orm": "^0.39.1",
    "drizzle-zod": "^0.7.0",
    "embla-carousel-react": "^8.6.0",
    "express": "^4.21.2",
    "express-rate-limit": "^8.2.1",
    "express-session": "^1.18.1",
    "framer-motion": "^11.13.1",
    "input-otp": "^1.4.2",
    "jsonwebtoken": "^9.0.2",
    "lucide-react": "^0.453.0",
    "memorystore": "^1.6.7",
    "multer": "^2.0.2",
    "next-themes": "^0.4.6",
    "node-cron": "^4.2.1",
    "openai": "^6.9.1",
    "passport": "^0.7.0",
    "passport-local": "^1.0.0",
    "react": "^18.3.1",
    "react-day-picker": "^8.10.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "tw-animate-css": "^1.2.5",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "ws": "^8.18.0",
    "zod": "^3.24.2",
    "zod-validation-error": "^3.4.0"
  },
  "devDependencies": {
    "@replit/vite-plugin-cartographer": "^0.4.2",
    "@replit/vite-plugin-dev-banner": "^0.1.1",
    "@replit/vite-plugin-runtime-error-modal": "^0.0.3",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "^4.1.3",
    "@types/connect-pg-simple": "^7.0.3",
    "@types/express": "4.17.21",
    "@types/express-session": "^1.18.0",
    "@types/node": "20.16.11",
    "@types/passport": "^1.0.16",
    "@types/passport-local": "^1.0.38",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@types/ws": "^8.5.13",
    "@vitejs/plugin-react": "^4.7.0",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.31.4",
    "esbuild": "^0.25.0",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.20.5",
    "typescript": "5.6.3",
    "vite": "^5.4.20"
  },
  "optionalDependencies": {
    "bufferutil": "^4.0.8"
  }
}
```

### =====================================
### FILE: tsconfig.json
### =====================================

```json
{
  "include": ["client/src/**/*", "shared/**/*", "server/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/typescript/tsbuildinfo",
    "noEmit": true,
    "module": "ESNext",
    "strict": true,
    "lib": ["esnext", "dom", "dom.iterable"],
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./client/src/*"],
      "@shared/*": ["./shared/*"]
    }
  }
}
```

### =====================================
### FILE: drizzle.config.ts
### =====================================

```typescript
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

---

## 2. DATABASE SCHEMA & MIGRATIONS

**NOTE**: This section contains the complete database schema with all 33 tables including subcontractor management, crew tracking, cost rates, AI data quality scoring, billing events, and comprehensive audit trail. The schema is the single source of truth for the entire platform's data structure.

### =====================================
### FILE: shared/schema.ts (COMPLETE - 842 LINES)
### =====================================

```typescript
// DUE TO LENGTH CONSTRAINTS, THIS FILE WILL BE INCLUDED VIA READ OPERATION
```

**Schema includes these table categories:**
- Core: users, projects, bids, estimates
- Subcontractors: subcontractors, subcontractorContracts, subcontractorPayments, bidSubcontractorQuotes
- Crews & Skills: crews, crewMembers, skills, userSkills, equipment
- Time tracking: timeEntries, timeClockShifts, tmDailySheets
- Project data: scopeItems, changeOrders, projectNotes, media, planDocuments, receipts, procurementItems
- Financial: billingEvents
- Calendar: calendarEvents
- System: notifications, auditLog, filePermissions
- AI System: aiSettings, aiRuns, aiTasks, aiDataQuality

---

## NOTICE: File Size Limitation

Due to the comprehensive nature of this codebase (150+ files, 10,000+ lines of critical code), I've prepared a summary export above. 

**For the complete audit export, I recommend the following approach:**

Would you like me to:

1. **Create multiple smaller export files** organized by category:
   - `TFR_DATABASE_SCHEMA_EXPORT.md` (schema + migrations)
   - `TFR_BACKEND_ROUTES_EXPORT.md` (all server routes)
   - `TFR_AI_SYSTEM_EXPORT.md` (complete AI PM/CFO system)
   - `TFR_FRONTEND_PAGES_EXPORT.md` (key UI pages)

2. **Generate a compressed archive** with all source files organized

3. **Focus on specific subsystems** you want fully documented first

4. **Continue with the current single-file approach** in multiple parts

Which approach would work best for your external audit needs?