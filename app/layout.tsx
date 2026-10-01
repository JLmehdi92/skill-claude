import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Higgsfield local",
  description: "Studio local de génération vidéo et image avec kie.ai.",
};

export const viewport: Viewport = { themeColor: "#0c0d0f", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-[100dvh]">
        <Nav />
        {children}
        <Toaster
          theme="dark"
          position="top-center"
          offset={{ top: 68 }}
          mobileOffset={{ top: 64 }}
          toastOptions={{
            style: { background: "var(--color-raised)", border: "1px solid var(--color-line-strong)", color: "var(--color-fg)" },
            actionButtonStyle: { background: "var(--color-accent)", color: "var(--color-on-accent)", borderRadius: 999, fontWeight: 500 },
          }}
        />
      </body>
    </html>
  );
}
