import { CookieSettingsButton } from "@/components/cookie-settings-button";
import { LegalPage, LegalSection } from "@/components/public-frame";

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      lead="Spectra uses a consent-based cookie model with required and optional categories."
      related={[
        { href: "/legal/privacy", label: "Privacy Notice" },
        { href: "/legal/terms", label: "Terms of Service" },
      ]}
    >
      <LegalSection title="Necessary cookies">
        <p>Required for sign-in, security protections, session continuity, and core product functionality.</p>
      </LegalSection>

      <LegalSection title="Preference cookies">
        <p>Store non-essential UI preferences and personalization settings. Disabled until you grant consent.</p>
      </LegalSection>

      <LegalSection title="Analytics cookies">
        <p>
          Used for optional product analytics. Disabled by default unless you choose Allow all or enable Analytics in
          Configure settings.
        </p>
      </LegalSection>

      <LegalSection title="Changing consent">
        <p>Use the persistent Cookie settings control in-app to update your choice at any time.</p>
        <CookieSettingsButton />
      </LegalSection>
    </LegalPage>
  );
}
