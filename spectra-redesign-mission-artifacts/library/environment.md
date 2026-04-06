# Environment

Environment variables, external dependencies, and setup notes for this mission.

**What belongs here:** required env vars, third-party dependencies, auth notes.  
**What does NOT belong here:** service commands/ports (use `.factory/services.yaml`).

---

## Required Environment Variables

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_DEPLOYMENT`
- `OPENROUTER_API_KEY`
- `MANAGEBAC_API_TOKEN`
- `MANAGEBAC_BASE_URL`

Optional but commonly used in this repo:
- `TAVILY_API_KEY`
- `GEMINI_API_KEY`
- SMTP variables for notifications (`SMTP_*`)

## Integration Notes

- This mission validates real integrations by default (OpenRouter, Convex, Clerk auth, ManageBac paths where applicable).
- If browser validation requires Google sign-in, pause and request user action for authentication.
- Do not log secret values in handoffs, tests, or console output.

## Cost / Model Policy

- Background and classifier lanes must prefer budget-safe cheap models.
- Expensive provider lanes are not default for this redesign.
