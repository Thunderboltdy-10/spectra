import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Manrope, IBM_Plex_Mono, Fraunces } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { FeedbackWidgetHost } from "@/components/feedback-widget-host";
import { Providers } from "@/components/providers";

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
  title: "AI School Assistant",
  description: "School AI assistant for students and teachers with live model routing, memory, and personalized study support.",
};

const themeInitScript = `
(function () {
  try {
    var key = 'ai-school-theme';
    var persisted = window.localStorage.getItem(key);
    var theme = persisted === 'dark' || persisted === 'light'
      ? persisted
      : 'light';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {
    document.documentElement.classList.remove('dark');
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? process.env.CLERK_PUBLISHABLE_KEY;

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
        <FeedbackWidgetHost />
      </body>
    </html>
  );

  if (!publishableKey) {
    return content;
  }

  return <ClerkProvider publishableKey={publishableKey}>{content}</ClerkProvider>;
}
