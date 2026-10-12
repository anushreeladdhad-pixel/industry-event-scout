"use client";
import { usePathname } from "next/navigation";

export default function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      <a href="/" className={path === "/" ? "on" : ""} aria-current={path === "/" ? "page" : undefined}>Digest</a>
      <a href="/settings" className={path === "/settings" ? "on" : ""} aria-current={path === "/settings" ? "page" : undefined}>Settings</a>
    </nav>
  );
}
