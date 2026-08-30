import type { SkillMetadata, SkillWithBody } from "./contracts";

type ApiEnvelope<T> = {
  data?: T;
  error?: string | { message?: string };
};

async function readResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message;
    throw new Error(message || "Skills are unavailable right now.");
  }
  return payload.data;
}

export async function listUserSkills() {
  return readResponse<SkillMetadata[]>(
    await fetch("/api/spectra/skills", { cache: "no-store" }),
  );
}

export async function readUserSkill(skillId: string) {
  return readResponse<SkillWithBody>(
    await fetch(`/api/spectra/skills?skillId=${encodeURIComponent(skillId)}`, {
      cache: "no-store",
    }),
  );
}

export async function deleteUserSkill(skillId: string) {
  return readResponse<{ removed: boolean; skillId?: string }>(
    await fetch("/api/spectra/skills", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillId }),
    }),
  );
}
