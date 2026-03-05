import { redirect } from "next/navigation";

export default function LegacySchoolMembersRedirectPage() {
  redirect("/admin?section=users");
}
