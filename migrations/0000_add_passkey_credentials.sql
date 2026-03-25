CREATE TABLE IF NOT EXISTS "passkey_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);

DO $$ BEGIN
 ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "passkey_credentials_credential_idx" ON "passkey_credentials" USING btree ("credential_id");
