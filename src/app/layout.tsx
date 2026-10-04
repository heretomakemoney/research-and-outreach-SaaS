import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Account Research",
  description: "Phase 1 research and outreach prototype",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
