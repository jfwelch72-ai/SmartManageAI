# TFR Construction Management Platform

## Overview
The TFR Construction Management Platform is a comprehensive internal tool designed to manage the entire project lifecycle for TFR Construction. Built with TypeScript, React, and PostgreSQL, its purpose is to streamline operations from bid tracking through project completion, enhancing efficiency and oversight across all construction activities. The platform aims to be the central hub for project data, user management, and daily operational tasks.

## User Preferences
I prefer clear, concise explanations and direct answers. I value an iterative development approach, focusing on delivering functional components incrementally. Please ask for my confirmation before implementing any major architectural changes or refactoring large portions of the codebase. I also prefer detailed explanations for complex solutions or significant design decisions.

## System Architecture
The platform is built with a modern web stack:
- **Frontend**: React with TypeScript, utilizing Wouter for routing, TanStack Query for data fetching, and styled with Tailwind CSS alongside shadcn/ui components for a consistent and responsive user interface.
- **Backend**: An Express.js server written in TypeScript.
- **Database**: PostgreSQL, hosted on Neon, managed with Drizzle ORM.
- **Authentication**: JWT-based authentication using httpOnly cookies for security, with bcrypt for password hashing.
- **UI/UX**: Emphasis on a clean, functional interface using shadcn/ui components and Tailwind CSS for rapid development and maintainability.
- **Key Features**:
    - **Authentication & Authorization**: Secure JWT-based system with six distinct user roles (ADMIN, MANAGER, SUPERINTENDENT, ESTIMATOR, OFFICE_MANAGER, HOURLY_EMPLOYEE), self-service registration, and admin-controlled user activation/role assignment.
    - **User Management**: Comprehensive admin interface for managing user accounts, roles, and activation status.
    - **Project Lifecycle Management**: Full CRUD operations for Bids, Projects, Estimates, Procurement items, and Change Orders, including bid-to-project conversion and project status tracking.
    - **Daily Operations**: Features for project notes, media uploads (photos/videos), and daily progress updates.
    - **Time & Materials**: Time entry system with a role-based approval workflow and T&M daily sheets for client billing.
    - **Calendar & Time-Off**: Monthly calendar view for events, with time-off request creation, approval workflows, and networking event tracking.
    - **Dashboard**: Real-time Key Performance Indicator (KPI) metrics and quick navigation to active projects, pending change orders, and time-off requests.
    - **File Storage & Permissions**: Comprehensive file management system with Replit Object Storage (Google Cloud Storage backend) for media, documents, and receipts. Features include:
        - Presigned URL uploads with Uppy progress tracking
        - Granular permission-based ACL: Admins/managers have full access; superintendents/hourly employees require explicit permission grants
        - filePermissions table tracking manager-granted access with fileTypeEnum (MEDIA, DOCUMENT, RECEIPT)
        - Private visibility for all uploads with automatic permission grants to uploaders
        - Permission management API endpoints for granting/revoking file access
        - ObjectUploader component integrated into project detail tabs with metadata dialogs
        - Security helpers (fileAccessHelpers.ts) for permission checks, file resolution, and listing filters
        - Orphaned object protection: download route blocks files not tracked in database

## External Dependencies
- **PostgreSQL (Neon)**: Primary database for all application data.
- **Replit Object Storage (Google Cloud Storage backend)**: Used for storing media files, documents, and receipts, leveraging presigned URLs for direct uploads.
- **JWT (JSON Web Tokens)**: For secure user authentication.
- **Bcrypt**: For hashing user passwords securely.
- **Uppy**: Frontend library for robust file upload progress tracking.