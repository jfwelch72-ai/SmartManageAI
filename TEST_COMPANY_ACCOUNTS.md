# SmartManageAI Test Company Accounts

**Purpose:** Full system testing with all features enabled  
**Created:** December 2025  
**Default Password for ALL Accounts:** `TestPass123!`

---

## Main Test Organization

### RealTest Construction

| Field | Value |
|-------|-------|
| **Organization Name** | RealTest Construction |
| **Slug** | realtest-construction |
| **Trade Type** | General Contractor |
| **Subscription Tier** | Enterprise (Scale) |
| **Billing Mode** | Manual |
| **Location** | 123 Main Street, Construction City, TX 75001 |
| **Phone** | 555-100-0000 |
| **Email** | info@realtest.com |
| **Crew Size** | 50 |
| **Region** | Southwest |

### Enabled Add-Ons (All Active)

| Add-On | Status | Description |
|--------|--------|-------------|
| AI PM Pack | ACTIVE | Task generation, risk alerts, daily summaries |
| AI CFO Pack | ACTIVE | Margin tracking, cashflow forecasting, financial alerts |
| AI Email & Admin | ACTIVE | Email categorization, task extraction, follow-ups |
| AI Vision Pack | ACTIVE | AI-powered plan takeoff and material estimation |
| Website + SEO Pack | ACTIVE | Website builder, SEO optimization, blog & gallery |
| Bid Network Pack | ACTIVE | Competitive vendor bidding platform |

### User Accounts

| Email | Password | Role | Name | Phone |
|-------|----------|------|------|-------|
| superadmin@realtest.com | TestPass123! | SUPER_ADMIN | Super Admin | 555-100-0001 |
| admin@realtest.com | TestPass123! | ADMIN | Organization Admin | 555-100-0002 |
| manager@realtest.com | TestPass123! | MANAGER | Project Manager | 555-100-0003 |
| super@realtest.com | TestPass123! | SUPERINTENDENT | Site Superintendent | 555-100-0004 |
| estimator@realtest.com | TestPass123! | ESTIMATOR | Cost Estimator | 555-100-0005 |
| office@realtest.com | TestPass123! | OFFICE_MANAGER | Office Manager | 555-100-0006 |
| worker@realtest.com | TestPass123! | HOURLY_EMPLOYEE | Field Worker | 555-100-0007 |
| maintenance@realtest.com | TestPass123! | MAINTENANCE_MANAGER | Equipment Manager | 555-100-0008 |
| vendor@realtest.com | TestPass123! | VENDOR | Vendor Contact | 555-100-0009 |
| hustler@realtest.com | TestPass123! | HUSTLER | Business Owner | 555-100-0010 |

---

## Subcontractor Organization

### RealTest Subcontractors

| Field | Value |
|-------|-------|
| **Organization Name** | RealTest Subcontractors |
| **Slug** | realtest-subcontractors |
| **Trade Type** | Concrete |
| **Subscription Tier** | Professional (Growth) |
| **Billing Mode** | Manual |
| **Location** | 456 Sub Street, Construction City, TX 75001 |
| **Phone** | 555-200-0000 |
| **Email** | info@realtest-sub.com |
| **Crew Size** | 15 |
| **Region** | Southwest |

### User Accounts

| Email | Password | Role | Name | Phone |
|-------|----------|------|------|-------|
| subadmin@realtest.com | TestPass123! | ADMIN | Sub Admin | 555-200-0001 |
| subestimator@realtest.com | TestPass123! | ESTIMATOR | Sub Estimator | 555-200-0002 |
| subforeman@realtest.com | TestPass123! | SUPERINTENDENT | Sub Foreman | 555-200-0003 |

---

## Role Capabilities Reference

### SUPER_ADMIN
- Platform-wide administrative access
- Can access /admin routes
- Manage all organizations
- Run platform audits
- View platform analytics

### ADMIN
- Organization-level administrator
- User management within organization
- Organization settings
- Full access to all org features

### MANAGER
- Project management
- Assign crew members
- Approve time entries
- View reports
- Manage bids and estimates

### SUPERINTENDENT
- Field operations
- Daily reports
- Time clock management
- Crew assignments
- Material tracking

### ESTIMATOR
- Bid creation and management
- Estimate development
- Takeoff tools
- Cost analysis
- Scope of work management

### OFFICE_MANAGER
- Administrative tasks
- Document management
- CRM access
- Messaging
- Invoice processing

### HOURLY_EMPLOYEE
- Time clock access
- View assigned projects
- Limited dashboard
- Basic messaging

### MAINTENANCE_MANAGER
- Equipment management
- Tool tracking
- Repair workflows
- Preventative maintenance scheduling

### VENDOR
- Vendor portal access
- Submit pricing
- View assigned projects
- Limited CRM features

### HUSTLER
- Multi-organization management
- Cross-org analytics
- COO delegation mode
- Portfolio insights
- Organization switcher

---

## Features Available for Testing

### Core Features (All Plans)
- Project Management
- Bid Management
- Estimate Builder with Takeoff
- Time Clock with GPS
- CRM System
- Document Management
- Internal Messaging
- User Management
- Dashboard

### Growth Features (Enabled)
- Production Rate Tracking
- Budget vs Actuals
- Vendor Invites
- Advanced Reports

### Scale Features (Enabled)
- Portfolio Dashboards
- Bid Network Access
- Website Builder
- Priority Support

### AI Features (All Add-Ons Enabled)
- AI Project Manager Assistant
- AI CFO Financial Analysis
- AI Email Classification & Task Extraction
- AI Vision Plan Takeoff
- AI Scheduling Assistant
- AI Change Order Generator

### Additional Systems
- Equipment Management
- Subcontractor Payables Workflow
- Delay Claims Tracking
- Inspection Scheduling
- Time & Material (T&M) Tracking
- Schedule of Values

---

## Quick Start Testing Guide

### 1. Login as Admin
```
Email: admin@realtest.com
Password: TestPass123!
```

### 2. Create a Test Bid
- Navigate to Bids
- Click "New Bid"
- Fill in project details
- Add scope items
- Create estimate

### 3. Test Time Clock
```
Login as: worker@realtest.com
```
- Clock in with GPS
- View assigned projects
- Clock out

### 4. Test AI Features
```
Login as: manager@realtest.com
```
- Open AI PM Dashboard
- View AI-generated tasks
- Check risk alerts

### 5. Test Subcontractor Flow
```
Login as: subadmin@realtest.com
```
- View subcontractor portal
- Submit pricing
- Respond to bid requests

### 6. Test Hustler Mode
```
Login as: hustler@realtest.com
```
- View multi-org dashboard
- Switch between organizations
- View cross-org analytics

---

## Running the Seed Script

To create or recreate these test accounts:

```bash
npm run seed:test-company
```

This will:
1. Remove any existing test accounts
2. Create RealTest Construction organization
3. Enable enterprise tier with all add-ons
4. Create all 10 user accounts
5. Create RealTest Subcontractors organization
6. Create 3 subcontractor users

---

## Notes

- All users have completed onboarding (walkthroughCompleted: true)
- All accounts are active and verified
- Organizations have "COMPLETED" onboarding status
- Enterprise tier provides unlimited projects and users
- The subcontractor org can be used to test:
  - Bid Network invitations
  - Subcontractor bid responses
  - Inter-organization workflows
