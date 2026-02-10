import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_CONVEX_URL: z.string().url(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  OPENROUTER_SITE_URL: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CONVEX_DEPLOYMENT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

export function getEnv() {
  if (!parsed.success) {
    const message = parsed.error.issues.map((err) => `${err.path.join(".")}: ${err.message}`).join("; ");
    throw new Error(`Invalid environment variables: ${message}`);
  }
  if (process.env.NODE_ENV === "production" && !parsed.data.OPENROUTER_API_KEY) {
    throw new Error("Invalid environment variables: OPENROUTER_API_KEY is required in production");
  }
  return parsed.data;
}

export function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}
