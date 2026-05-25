# website-builder — Org Websites, Pages, Blog Posts, Social Media Posts, Deployments, SEO

## Overview

The website builder module allows construction companies to create and publish a white-label marketing website hosted at `https://[slug].smartmanageai.com`. Admins create pages with a block editor, publish blog posts, schedule social media posts, and view site analytics. The public website is rendered server-side by Express with EJS templates and cached at the CDN level. Each org gets a unique `subdomain` slug.

## Data Models

**Key tables (`shared/schema/features/website.ts`)**

| Table | Description |
|---|---|
| `org_websites` | Website config: `organizationId`, `subdomain`, `customDomain`, `isPublished`, `theme`, `primaryColor`, `logoUrl`, `faviconUrl`, `googleAnalyticsId`, `metaTitle`, `metaDescription` |
| `website_pages` | `websiteId`, `slug`, `title`, `metaDescription`, `blocks` (JSONB block editor content), `status` (DRAFT/PUBLISHED), `publishedAt`, `order` |
| `website_blog_posts` | Blog posts: `websiteId`, `slug`, `title`, `content` (JSONB), `excerpt`, `coverImageUrl`, `authorId`, `status`, `publishedAt`, `tags` |
| `website_social_posts` | `websiteId`, `content`, `imageUrl`, `platforms` (JSON array), `scheduledAt`, `status` (DRAFT/SCHEDULED/PUBLISHED/FAILED), `externalIds` (JSON per-platform post IDs) |
| `website_form_submissions` | Captures from website contact forms: `websiteId`, `formData` (JSON), `submittedAt`, `ipAddress` |
| `website_analytics_events` | Page view events: `websiteId`, `path`, `referrer`, `sessionId`, `timestamp`, `deviceType` |
| `website_analytics_summaries` | Daily aggregated analytics: `websiteId`, `date`, `pageViews`, `uniqueVisitors`, `topPages` (JSON) |
| `website_deployments` | Deployment records: `websiteId`, `triggeredById`, `status` (QUEUED/BUILDING/LIVE/FAILED), `deployedAt`, `buildDurationMs` |
| `website_templates` | Pre-built website templates: `name`, `category`, `previewUrl`, `blocksJson` |
| `website_media_library` | Uploaded images for website use |

## Backend Routes

**File: `server/websiteBuilderRoutes.ts`** — website management:
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/website/config` | Returns org website config | `canManageWebsite` |
| PUT | `/api/website/config` | Updates config (theme, logo, domain) | `canManageWebsite` |
| POST | `/api/website/publish` | Creates deployment | `canManageWebsite` |
| GET | `/api/website/deployments` | Lists deployments | `canManageWebsite` |
| GET | `/api/website/pages` | Lists pages | `canManageWebsite` |
| POST | `/api/website/pages` | Creates page | `canManageWebsite` |
| PATCH | `/api/website/pages/:id` | Updates page content | `canManageWebsite` |
| DELETE | `/api/website/pages/:id` | Deletes page | `canManageWebsite` |
| POST | `/api/website/pages/:id/publish` | Publishes page | `canManageWebsite` |
| GET | `/api/website/blog-posts` | Lists blog posts | `canManageWebsite` |
| POST | `/api/website/blog-posts` | Creates blog post | `canManageWebsite` |
| PATCH | `/api/website/blog-posts/:id` | Updates post | `canManageWebsite` |
| POST | `/api/website/social-posts` | Creates social post | `canManageWebsite` |
| GET | `/api/website/analytics` | Page view analytics | `canManageWebsite` |
| GET | `/api/website/form-submissions` | Contact form submissions | `canManageWebsite` |
| POST | `/api/website/media` | Uploads media to library | `canManageWebsite` + `uploadLimiter` |

**File: `server/publicWebsiteRoutes.ts`** — public rendering (no auth):
| Method | Path | Description |
|---|---|---|
| GET | `/site/:subdomain` | Renders org website (production) |
| GET | `/site/:subdomain/staging` | Renders staging preview |
| GET | `/site/:subdomain/blog` | Blog listing page |
| GET | `/site/:subdomain/blog/:slug` | Blog post page |
| POST | `/site/:subdomain/contact` | Handles contact form submission |

**File: `server/socialMediaRoutes.ts`** — social scheduling and publishing

## Frontend Pages & Components

| Route | Page File | Description |
|---|---|---|
| `/company-settings?tab=website` | `client/src/pages/company-settings.tsx` | Website builder launch point |
| `/site/:subdomain` | `client/src/pages/public-website.tsx` | Public website renderer (React SSR-lite) |
| `/site/:subdomain/staging` | same, with `isStaging=true` | Staging preview |

The website builder embedded in company settings uses a block editor (custom implementation) with block types: Hero, About, Services, Gallery, Testimonials, Contact Form, Call-to-Action, Text, Image, Video.

## Roles & Permissions

| Action | Gate |
|---|---|
| Access website builder | `canManageWebsite` — ADMIN, SUPER_ADMIN |
| Publish website | `canManageWebsite` |
| View analytics | `canManageWebsite` |
| Manage social posts | `canManageWebsite` |

## Integration Points

- **Subdomain routing** — Express matches `/site/:subdomain` routes; `org_websites.subdomain` is looked up to resolve the org; CDN (Cloudflare) is configured with a wildcard CNAME for `*.smartmanageai.com`
- **Custom domains** — `org_websites.customDomain` supports BYOD; domain verification uses TXT record check via DNS lookup in `websiteBuilderRoutes.ts`
- **Social publishing** — `socialMediaRoutes.ts` calls platform APIs (Facebook Graph, Instagram Basic Display, LinkedIn) using org-connected OAuth tokens stored in `integration_connections`
- **AI content generation** — website content and blog posts can be drafted by AI via `governedAiCall()`; prompt templates live in `server/ai/templates/websiteContent.ts`
- **Analytics events** — `POST /api/website/analytics-event` (public, no auth) is called from a `<script>` snippet embedded in the public website; rate-limited by IP
- **Deployment** — `POST /api/website/publish` enqueues a build job in the job queue; build compiles page blocks to static HTML; result stored as GCS objects served via CDN
