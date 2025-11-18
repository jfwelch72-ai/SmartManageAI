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
- Role-based access control (ADMIN, MANAGER, SUPERINTENDENT, HOURLY_EMPLOYEE)
- Protected routes on frontend with AuthProvider
- Password hashing with bcrypt

### User Management
- Create, read, update users (Admin only)
- Role assignment
- Active/inactive status management

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
- POST `/api/auth/login` - Login with email/password
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
- 2025-11-18: Fixed critical authentication bugs
  - Updated seed.ts to create all three demo accounts with properly hashed passwords
  - Fixed logout functionality to properly clear session state on all pages
  - Updated AppHeader to await logout Promise for reliable single-click logout
- 2025-11-18: Complete backend API implementation with authentication, authorization, and all CRUD operations
- 2025-11-18: Frontend authentication integration with protected routes
- 2025-11-18: Database schema creation with 12 tables covering all project lifecycle needs

## Next Steps
- Connect frontend pages to backend API endpoints
- Implement file upload handling for documents, receipts, and media
- Add dashboard KPIs with real aggregated data
- Implement role-based UI filtering
