# TFR Construction Management Platform

## Overview
A comprehensive internal construction management platform for TFR Construction built with TypeScript, React, and PostgreSQL. The system manages the complete project lifecycle from bid tracking through project completion.

## Architecture
- **Frontend**: React with TypeScript, Wouter routing, TanStack Query
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Authentication**: JWT with httpOnly cookies, bcrypt password hashing
- **Styling**: Tailwind CSS with shadcn/ui components

## Features Implemented

### Authentication & Authorization
- JWT-based authentication with secure httpOnly cookies
- Six-role system: ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE
- Self-service user registration with company email
- New users created as inactive by default (require admin approval)
- Protected routes on frontend with AuthProvider
- Password hashing with bcrypt

### User Management
- Self-service registration at `/register` (no authentication required)
- Admin user management page at `/users` showing all users
- Admin-controlled user activation/deactivation via toggle
- Admin-controlled role assignment via dropdown
- Inactive users cannot log in until activated by admin

### Bid Management
- Full CRUD operations for bids
- Bid-to-project conversion workflow
- Bid tracking separate from active projects

### Project Management
- Project CRUD operations
- Project status tracking (BID, PLANNING, ACTIVE, COMPLETE, CLOSED)
- Scope of work tracking with quantity management
- Progress calculations based on completed quantities

### Daily Operations
- Project notes with timestamps and author tracking
- Media uploads (photos/videos) for site documentation
- Daily progress updates by superintendents

### Time & Materials
- Time entry system with approval workflow
- T&M daily sheets for client billing
- Time entry filtering by role (hourly employees see only their entries)

### Supporting Features
- Estimates with versioning
- Procurement item tracking with status updates
- Receipt uploads and categorization
- Plan document management

## Database Schema
12 tables covering the complete project lifecycle:
- users
- projects
- bids
- estimates
- procurementItems
- planDocuments
- timeEntries
- tmDailySheets
- receipts
- projectNotes
- scopeItems
- media

## Security Notes
- **Demo Accounts**: The seed script creates three demo accounts for testing:
  - Admin: `admin@tfrllc.com` / `admin123` (ADMIN role)
  - Manager: `sarah@tfrconst.com` / `password123` (MANAGER role)
  - Superintendent: `jake@tfrconstructionohio.com` / `password123` (SUPERINTENDENT role)
  - **IMPORTANT**: Change these passwords before production use
- All passwords are properly hashed with bcrypt before storage
- Logout functionality properly clears session state across all pages

## API Routes
All routes are prefixed with `/api` and require authentication unless specified.

### Authentication
- POST `/api/auth/register` - Register new user (no auth required, creates inactive user)
- POST `/api/auth/login` - Login with email/password (requires active account)
- POST `/api/auth/logout` - Logout
- GET `/api/auth/me` - Get current user
- POST `/api/auth/init` - Initialize admin user (one-time)

### Users
- GET `/api/users` - List all users (Admin/Manager)
- GET `/api/users/:id` - Get user by ID (Admin/Manager)
- POST `/api/users` - Create user (Admin)
- PATCH `/api/users/:id` - Update user (Admin)

### Bids
- GET `/api/bids` - List all bids
- GET `/api/bids/:code` - Get bid by code
- POST `/api/bids` - Create bid (Admin/Manager)
- PATCH `/api/bids/:code` - Update bid (Admin/Manager)
- DELETE `/api/bids/:code` - Delete bid (Admin)
- POST `/api/bids/:code/convert` - Convert bid to project (Admin/Manager)

### Projects
- GET `/api/projects` - List all projects
- GET `/api/projects/:code` - Get project with scope items
- POST `/api/projects` - Create project (Admin/Manager)
- PATCH `/api/projects/:code` - Update project (Admin/Manager)

### Scope of Work
- GET `/api/projects/:code/scope` - Get scope items for project
- POST `/api/projects/:code/scope` - Create scope item (Admin/Manager/Superintendent)
- PATCH `/api/scope-items/:id` - Update scope item (Admin/Manager/Superintendent)
- DELETE `/api/scope-items/:id` - Delete scope item (Admin/Manager)

### Project Notes
- GET `/api/projects/:code/notes` - Get notes for project
- POST `/api/projects/:code/notes` - Create note (All authenticated)

### Media
- GET `/api/projects/:code/media` - Get media for project
- POST `/api/projects/:code/media` - Create media record (All authenticated)
- DELETE `/api/media/:id` - Delete media (Admin/Manager/Superintendent or uploader)

### Time Entries
- GET `/api/time-entries` - Get time entries (filtered by role)
- GET `/api/projects/:code/time-entries` - Get time entries for project
- POST `/api/time-entries` - Create time entry (All authenticated)
- POST `/api/time-entries/:id/approve` - Approve time entry (Admin/Manager)

### T&M Daily Sheets
- GET `/api/projects/:code/tm-sheets` - Get T&M sheets for project
- POST `/api/tm-sheets` - Create T&M sheet (Admin/Manager/Superintendent)

### Estimates
- GET `/api/projects/:code/estimates` - Get estimates for project
- POST `/api/estimates` - Create estimate (Admin/Manager)

### Procurement
- GET `/api/projects/:code/procurement` - Get procurement items for project
- POST `/api/procurement` - Create procurement item (Admin/Manager)
- PATCH `/api/procurement/:id` - Update procurement item (Admin/Manager)

### Receipts
- GET `/api/projects/:code/receipts` - Get receipts for project
- POST `/api/receipts` - Create receipt (All authenticated)

### Documents
- GET `/api/projects/:code/documents` - Get documents for project
- POST `/api/documents` - Create document (Admin/Manager)

## Development

### Running the Application
The application runs on port 5000 with:
```bash
npm run dev
```

This starts both the Express backend and Vite frontend development servers.

### Database
```bash
npm run db:push  # Push schema changes to database
```

## Recent Changes
- 2025-11-18: Phase 0 & Phase 1 Complete - Projects Page with Real Data
  - Created comprehensive seed data with 4 demo users, 3 projects, 2 bids, scope items (varying billing statuses), time entries, change orders, calendar events, and notifications
  - Enhanced GET /api/projects endpoint to join with users table and return estimator/superintendent names using inArray
  - Created ProjectWithNames type extending Project with optional estimator/superintendent fields
  - Updated useProjects() hook to return ProjectWithNames[] for proper typing
  - Projects page now displays real data including assigned personnel names
  - E2E test verified: login → projects page → superintendent and estimator columns populated correctly
- 2025-11-18: Implemented self-service user registration and admin user management
  - Added ESTIMATOR and OFFICE_MANAGER roles (total 6 roles now)
  - Created registration page at `/register` with form validation
  - Built admin user management page at `/users` with role assignment and activation controls
  - New users created as inactive by default, requiring admin approval before login
  - Successfully tested complete workflow: register → admin approval → role assignment → login
- 2025-11-18: Fixed critical authentication bugs
  - Updated seed.ts to create all three demo accounts with properly hashed passwords
  - Fixed logout functionality to properly clear session state on all pages
  - Updated AppHeader to await logout Promise for reliable single-click logout
- 2025-11-18: Complete backend API implementation with authentication, authorization, and all CRUD operations
- 2025-11-18: Frontend authentication integration with protected routes
- 2025-11-18: Database schema creation with 12 tables covering all project lifecycle needs

## Next Steps
- Phase 1: Build/Update Project Detail page with tabbed interface (Overview, Scope of Work, Notes, Media, Time Entries, Change Orders)
- Phase 2: Implement Time Entry system with approval workflows and T&M Daily Sheet submission
- Phase 3: Build Calendar with time-off requests and approvals
- Phase 4: Add Dashboard with real KPIs from aggregated data
- Implement file upload handling for documents, receipts, and media
- Implement role-based UI filtering
