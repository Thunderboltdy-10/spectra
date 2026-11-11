import { SchoolPage as SchoolSurface } from "@/features/spectra/school/school-page";
import { SchoolMembershipGate } from "@/features/spectra/components/school-membership-gate";

export const dynamic = "force-dynamic";

export default function SchoolPage() {
  return (
    <SchoolMembershipGate>
      <SchoolSurface />
    </SchoolMembershipGate>
  );
}
