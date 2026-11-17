import type { Metadata, Viewport } from "next";
import { Mona_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { Nav } from "@/components/nav";
import "./globals.css";

// One variable family; the wdth axis gives the wide cut used by titles and amounts.
const mona = Mona_Sans({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-mona", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Higgsfield local", template: "%s | Higgsfield local" },
  description: "Studio local de génération vidéo et image avec kie.ai.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e3e3e0" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1d20" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={mona.variable}>
      <body className="min-h-[100dvh]">
        <Nav />
        {children}
        <Toaster
          theme="system"
          position="top-center"
          offset={{ top: 68 }}
          mobileOffset={{ top: 64 }}
          toastOptions={{
            style: {
              background: "var(--raised)",
              border: "1px solid var(--line-strong)",
              color: "var(--fg)",
              borderRadius: 12,
              boxShadow: "var(--elevation)",
              fontFamily: "var(--font-sans)",
            },
            descriptionClassName: "!text-muted",
            actionButtonStyle: { background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontWeight: 600 },
          }}
        />
      </body>
    </html>
  );
}
