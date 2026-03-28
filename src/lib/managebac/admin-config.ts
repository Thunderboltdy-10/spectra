type ManagebacMember = {
  _id: string;
  clerkId: string;
  email: string;
  role: "student" | "teacher" | "admin";
};

type ManagebacStudentMapping = {
  clerkId: string;
  managebacStudentId: string;
  email?: string;
};

export function buildManagebacMappingState(studentMappings: ManagebacStudentMapping[]) {
  return Object.fromEntries(
    studentMappings
      .filter((mapping) => mapping.clerkId.trim() && mapping.managebacStudentId.trim())
      .map((mapping) => [mapping.clerkId.trim(), mapping.managebacStudentId.trim()]),
  );
}

export function buildManagebacStudentMappings(
  members: ManagebacMember[],
  mappingsByClerkId: Record<string, string>,
) {
  return members
    .filter((member) => member.role === "student")
    .map((member) => ({
      clerkId: member.clerkId.trim(),
      email: member.email,
      managebacStudentId: mappingsByClerkId[member.clerkId]?.trim(),
    }))
    .filter((mapping) => mapping.clerkId && mapping.managebacStudentId);
}
