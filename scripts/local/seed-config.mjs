import { createHash, createHmac } from "node:crypto";

export const DEFAULT_SCHOOL = Object.freeze({
  name: "The Global College",
  slug: "the-global-college",
  timezone: "Europe/Madrid",
});

export function normalizeEmail(value, label = "Email") {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`${label} must be a valid email address.`);
  }
  return email;
}

export function parseSeedArguments(argv) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "verify-only") {
      flags.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }
    values[name] = value;
    index += 1;
  }
  return { values, flags };
}

function operatorEmails(env) {
  return Array.from(
    new Set(
      String(env.SUPER_ADMIN_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function resolveOperatorEmail(env, explicitEmail) {
  const configured = operatorEmails(env);
  if (configured.length === 0) {
    throw new Error(
      "SUPER_ADMIN_EMAILS must contain the secondary account before seeding.",
    );
  }
  if (explicitEmail) {
    const selected = normalizeEmail(explicitEmail, "Operator email");
    if (!configured.includes(selected)) {
      throw new Error(
        "The selected operator email is not registered in SUPER_ADMIN_EMAILS.",
      );
    }
    return selected;
  }
  if (configured.length !== 1) {
    throw new Error(
      "SUPER_ADMIN_EMAILS contains more than one address; pass --operator-email explicitly.",
    );
  }
  return normalizeEmail(configured[0], "Operator email");
}

export function assertLocalSeedTarget({ appEnv, projectEnv, ports }) {
  const convexUrl = String(appEnv.NEXT_PUBLIC_CONVEX_URL ?? "").trim();
  const deployment = String(
    projectEnv.CONVEX_DEPLOYMENT ?? appEnv.CONVEX_DEPLOYMENT ?? "",
  ).trim();
  let parsed;
  try {
    parsed = new URL(convexUrl);
  } catch {
    throw new Error("The instance Convex URL is missing or invalid.");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    Number(parsed.port) !== Number(ports.convexCloud)
  ) {
    throw new Error("Seed refused: the Convex target is not this local instance.");
  }
  if (!deployment.startsWith("local:")) {
    throw new Error("Seed refused: CONVEX_DEPLOYMENT is not local.");
  }
}

export function seedMaterial({
  instanceId,
  env,
  operatorEmail,
  adminEmail,
  school = DEFAULT_SCHOOL,
}) {
  const normalizedOperator = normalizeEmail(operatorEmail, "Operator email");
  const normalizedAdmin = normalizeEmail(adminEmail, "Administrator email");
  if (normalizedOperator === normalizedAdmin) {
    throw new Error("Operator and school administrator must be different accounts.");
  }
  const secret = String(env.SPECTRA_MASTER_ENCRYPTION_KEY ?? "").trim();
  if (Buffer.from(secret, "base64").length !== 32) {
    throw new Error(
      "SPECTRA_MASTER_ENCRYPTION_KEY must be a 32-byte base64 key before seeding.",
    );
  }
  const adminDigest = createHash("sha256")
    .update(normalizedAdmin)
    .digest("hex")
    .slice(0, 16);
  const seedKey = `spectra-local-bootstrap:v1:${instanceId}:${school.slug}:${adminDigest}`;
  const invitationToken = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${seedKey}:school-admin-invitation`)
    .digest("base64url");
  return {
    operatorEmail: normalizedOperator,
    adminEmail: normalizedAdmin,
    school,
    seedKey,
    invitationToken,
    tokenHash: createHash("sha256")
      .update(invitationToken)
      .digest("base64url"),
  };
}

export function identityForAccount(account) {
  if (!account?.clerkId || !account?.email || !account?.name) {
    throw new Error("The signed-in operator account is incomplete.");
  }
  return {
    subject: account.clerkId,
    tokenIdentifier: `local-bootstrap|${account.clerkId}`,
    issuer: "spectra-local-bootstrap",
    email: normalizeEmail(account.email, "Operator account email"),
    emailVerified: true,
    name: account.name,
  };
}

export function schoolCreateArgs(material) {
  return {
    name: material.school.name,
    slug: material.school.slug,
    timezone: material.school.timezone,
    verifiedDomains: [],
    initialAdminEmail: material.adminEmail,
    tokenHash: material.tokenHash,
    idempotencyKey: material.seedKey,
    requestId: `local-bootstrap:${material.seedKey}`.slice(0, 120),
  };
}

export function bootstrapJoinUrl(appUrl, invitationToken) {
  let parsed;
  try {
    parsed = new URL(String(appUrl ?? "").trim());
  } catch {
    throw new Error("The local app URL is missing or invalid.");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("The invitation target is not a local app URL.");
  }
  parsed.hostname = "localhost";
  parsed.pathname = "/join";
  parsed.search = "";
  parsed.hash = "";
  parsed.searchParams.set("token", invitationToken);
  return parsed.toString();
}

export function verifyBootstrapProjection(projection, material) {
  const problems = [];
  if (!projection?.school) problems.push("The Global College school is missing");
  if (projection?.school?.slug !== material.school.slug)
    problems.push("the school slug does not match the seed");
  if (!projection?.saga) problems.push("the onboarding saga is missing");
  if (projection?.saga?.idempotencyKey !== material.seedKey)
    problems.push("the onboarding saga does not match the deterministic seed");
  if (!projection?.invitation)
    problems.push("the initial administrator invitation is missing");
  if (projection?.invitation?.email !== material.adminEmail)
    problems.push("the invitation targets the wrong account");
  if (projection?.invitation?.role !== "school_admin")
    problems.push("the invitation role is not school_admin");
  if (projection?.membership) {
    if (projection.membership.role !== "school_admin")
      problems.push("account A is not a school_admin");
    if (projection.membership.status !== "active")
      problems.push("account A membership is not active");
    if (projection?.saga?.status !== "ready")
      problems.push("the onboarding saga did not reach ready");
  } else if (projection?.saga?.status !== "invited") {
    problems.push("the pre-acceptance saga is not invited");
  }
  if (problems.length > 0) {
    throw new Error(`Local bootstrap verification failed: ${problems.join("; ")}.`);
  }
  return {
    school: projection.school.name,
    sagaStatus: projection.saga.status,
    invitationStatus: projection.invitation.status,
    adminEstablished: Boolean(projection.membership),
  };
}
