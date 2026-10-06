import { LegalPage, LegalSection } from "@/components/public-frame";

export default function PrivacyNoticePage() {
  return (
    <LegalPage
      title="Privacy Notice"
      lead="This notice explains what data Spectra processes and why."
      related={[
        { href: "/legal/cookies", label: "Cookie Policy" },
        { href: "/legal/terms", label: "Terms of Service" },
      ]}
    >
      <LegalSection title="Data we process">
        <p>
          Account profile details, conversation content, attachments you upload, and operational events needed for safety,
          billing, and product reliability.
        </p>
      </LegalSection>

      <LegalSection title="How data is used">
        <p>
          We use your data to run the product, provide educational features, keep services secure, and improve quality.
          Optional analytics are only active if you consent.
        </p>
      </LegalSection>

      <LegalSection title="Your controls">
        <p>You can update cookie preferences anytime using the cookie settings button in the app.</p>
      </LegalSection>
    </LegalPage>
  );
}
