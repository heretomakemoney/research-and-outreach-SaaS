import type { Metadata } from "next";
import { aiMode } from "@/lib/mode";
import "./globals.css";

export const metadata: Metadata = {
  title: "Account Research",
  description: "Phase 1 research and outreach prototype",
  robots: { index: false, follow: false },
};

// Read the mode on every request (not frozen at build time), so the banner always matches the server.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {aiMode() === "mock" && (
          <div className="mock-banner" role="status">
            <strong>MOCK MODE: no paid calls.</strong> Research, synthesis and emails come from a saved sample
            (Upper Hunter), whatever company you type.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
