ALTER TYPE "public"."website_page_type" ADD VALUE 'CAREERS';--> statement-breakpoint
ALTER TABLE "organization_websites" ADD COLUMN IF NOT EXISTS "careers_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organization_websites" ADD COLUMN IF NOT EXISTS "careers_intro_text" text;
