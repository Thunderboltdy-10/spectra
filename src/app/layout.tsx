import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Figtree, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SkipLink } from "@/components/ui/skip-link";
import { getClerkPublishableKey } from "@/lib/clerk-config";
import { checkDeploymentConsistency } from "@/lib/boot-diagnostics";

// Run at module load time (server only). Logs a warning if the Convex
// deployment and public URL variables disagree on environment.
checkDeploymentConsistency();

// The type system (docs/design/LANGUAGE.md): Figtree for the interface, Newsreader for titles and
// reading, Plex Mono for code and figures.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
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
  description:
    "Spectra is a collaborative AI workspace for connected artifacts, people, and evidence.",
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
      "Spectra is a collaborative AI workspace for connected artifacts, people, and evidence.",
    siteName: "Spectra",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = getClerkPublishableKey();

  const content = (
    // The font variables sit on the root, where the tokens that name them (--font-sans, --font-display) are declared.
    <html lang="en" suppressHydrationWarning className={`${figtree.variable} ${newsreader.variable} ${plexMono.variable}`}>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("spectra:sidebar-collapsed")==="true")document.documentElement.dataset.spectraSidebarCollapsed="true"}catch{}',
          }}
        />
      </head>
      <body className="antialiased">
        <SkipLink />
        <div id="page-content" tabIndex={-1}>
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
