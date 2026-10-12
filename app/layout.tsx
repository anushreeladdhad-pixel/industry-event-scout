import "./globals.css";
import type { Metadata, Viewport } from "next";
import Nav from "./nav";

export const metadata: Metadata = {
  title: "Industry Event Scout",
  description: "A Monday-morning digest of relevant industry events, ranked and deadline-flagged.",
};
export const viewport: Viewport = { themeColor: "#4338ca" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand"><span className="logo" aria-hidden>◎</span>Event Scout</a>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
