import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Manrope, IBM_Plex_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getClerkPublishableKey } from "@/lib/clerk-config";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spectra — The AI School Platform",
  description: "Spectra routes every question to the right AI — the right model, the right mode, the right context. Purpose-built for schools.",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    title: "Spectra — The AI School Platform",
    description: "Spectra routes every question to the right AI — the right model, the right mode, the right context. Purpose-built for schools.",
    siteName: "Spectra",
  },
};

const themeInitScript = `
(function () {
  try {
    var consentKey = 'ai-school-cookie-consent-v1';
    var key = 'ai-school-theme';
    var consentRaw = window.localStorage.getItem(consentKey);
    var canUsePreferences = false;
    if (consentRaw) {
      try {
        var consent = JSON.parse(consentRaw);
        canUsePreferences = !!(consent && consent.preferences);
      } catch (e) {
        canUsePreferences = false;
      }
    }
    var persisted = canUsePreferences ? window.localStorage.getItem(key) : null;
    var theme = persisted === 'dark' || persisted === 'light'
      ? persisted
      : 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    var validPalettes = ['slate', 'zinc', 'rose', 'custom'];
    var palette = window.localStorage.getItem('ai-school:color-theme');
    if (palette && validPalettes.indexOf(palette) !== -1) {
      document.documentElement.setAttribute('data-theme-palette', palette);
      if (palette === 'custom') {
        var customPrimary = window.localStorage.getItem('ai-school:custom-primary-color') || '#0e8ee8';
        var customSecondary = window.localStorage.getItem('ai-school:custom-secondary-color') || '#20b8b2';
        var mixedCore = 'color-mix(in oklab, ' + customPrimary + ' 56%, ' + customSecondary + ')';
        document.documentElement.style.setProperty('--brand-primary', customPrimary);
        document.documentElement.style.setProperty('--brand-accent', customSecondary);
        document.documentElement.style.setProperty('--custom-theme-light', 'color-mix(in oklab, ' + mixedCore + ' 14%, #ffffff)');
        document.documentElement.style.setProperty('--custom-theme-dark', 'color-mix(in oklab, ' + mixedCore + ' 28%, #000000)');
      }
    }
  } catch (e) {
    document.documentElement.classList.remove('dark');
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = getClerkPublishableKey();

  const content = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${manrope.variable} ${fraunces.variable} ${plexMono.variable} antialiased`}>
        <a
          href="#main-content"
          className="skip-link sr-only focus:not-sr-only"
        >
          Skip to content
        </a>
        <div id="main-content" tabIndex={-1}>
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );

  if (!publishableKey) {
    return content;
  }

  return <ClerkProvider publishableKey={publishableKey}>{content}</ClerkProvider>;
}
