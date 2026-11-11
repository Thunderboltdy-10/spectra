/**
 * One access caption for studio chrome. Durable share level and the live
 * room level both count: a Library snapshot can lag a permission change,
 * and a reconnecting socket must not keep saying "You can modify."
 */

export const ACCESS_INSPECT =
  "You can inspect, comment, and place this artifact, but only a collaborator with modify access can change it.";

export const ACCESS_MODIFY = "You can modify this artifact.";

export function sharedAccessExplanation(input: {
  ownership?: "owned" | "shared" | null;
  accessReason?: string | null;
  workspaceTitles?: string;
}): string | null {
  if (input.ownership !== "shared") return null;
  if (input.accessReason === "workspace_inheritance") {
    return `Access through ${input.workspaceTitles || "a workspace"}`;
  }
  return "Shared directly with you";
}

export function sharedSessionIsReadOnly(input: {
  ownership?: "owned" | "shared" | null;
  durableReadOnly: boolean;
  liveLevel?: "read" | "modify" | null;
}): boolean {
  return (
    input.durableReadOnly ||
    (input.ownership === "shared" && input.liveLevel === "read")
  );
}

export function artifactAccessBanner(input: {
  ownership?: "owned" | "shared" | null;
  accessLevel?: "read" | "modify" | null;
  accessReason?: string | null;
  workspaceTitles?: string;
  liveLevel?: "read" | "modify" | null;
  protectedOriginal?: boolean;
  protectedOriginalCopy?: string;
  syllabus?: boolean;
}): { tone: "inspect" | "modify"; text: string } | null {
  if (input.syllabus) {
    return { tone: "inspect", text: "A course reference from official IB sources. Read only; make a copy to add your own notes. Check its source links for the full requirements." };
  }
  if (input.protectedOriginal && input.protectedOriginalCopy) {
    return { tone: "inspect", text: input.protectedOriginalCopy };
  }
  const explanation = sharedAccessExplanation(input);
  const inspect = sharedSessionIsReadOnly({
    ownership: input.ownership,
    durableReadOnly: input.accessLevel === "read",
    liveLevel: input.liveLevel,
  });
  if (inspect) {
    return {
      tone: "inspect",
      text: explanation
        ? `Read-only access · ${explanation} · ${ACCESS_INSPECT}`
        : `Read-only access · ${ACCESS_INSPECT}`,
    };
  }
  if (!explanation) return null;
  return { tone: "modify", text: `${explanation} · ${ACCESS_MODIFY}` };
}
