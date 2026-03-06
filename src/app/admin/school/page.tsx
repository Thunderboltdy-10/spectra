import { redirect } from "next/navigation";

export default function LegacySchoolAdminRedirectPage() {
  redirect("/admin");
}
