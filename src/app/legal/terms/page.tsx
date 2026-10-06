import { LegalPage, LegalSection } from "@/components/public-frame";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lead="These terms govern usage of Spectra services and features."
      related={[
        { href: "/legal/privacy", label: "Privacy Notice" },
        { href: "/legal/cookies", label: "Cookie Policy" },
      ]}
    >
      <LegalSection title="Acceptable use">
        <p>Use the platform for lawful educational activities. Do not attempt misuse, abuse, or policy evasion.</p>
      </LegalSection>

      <LegalSection title="User content">
        <p>You are responsible for content you submit. Upload only materials you are authorized to use.</p>
      </LegalSection>

      <LegalSection title="Service changes">
        <p>Features can evolve over time, including model availability, limits, and user interface behavior.</p>
      </LegalSection>

      <LegalSection title="Privacy and cookies">
        <p>Data handling is described in the Privacy Notice and Cookie Policy.</p>
      </LegalSection>
    </LegalPage>
  );
}
