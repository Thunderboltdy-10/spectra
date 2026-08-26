import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { getClerkPublishableKey } from "@/lib/clerk-config";
import { checkDeploymentConsistency } from "@/lib/boot-diagnostics";

// Run at module load time (server only). Logs a warning if the Convex
// deployment and public URL variables disagree on environment.
checkDeploymentConsistency();

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spectra — The AI School Platform",
  description:
    "Spectra is a collaborative AI workspace for connected work, people, and evidence.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192" }],
  },
  openGraph: {
    title: "Spectra — The AI School Platform",
    description:
      "Spectra is a collaborative AI workspace for connected work, people, and evidence.",
    siteName: "Spectra",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = getClerkPublishableKey();

  const content = (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("spectra:sidebar-collapsed")==="true")document.documentElement.dataset.spectraSidebarCollapsed="true"}catch{}',
          }}
        />
      </head>
      <body className={`${manrope.variable} ${plexMono.variable} antialiased`}>
        <a href="#main-content" className="skip-link sr-only focus:not-sr-only">
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

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInFallbackRedirectUrl="/workspace"
      signUpFallbackRedirectUrl="/workspace"
      afterSignOutUrl="/"
    >
      {content}
    </ClerkProvider>
  );
}
