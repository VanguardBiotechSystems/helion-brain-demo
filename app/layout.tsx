import type { Metadata, Viewport } from "next";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Helion";

export const metadata: Metadata = {
  title: `${appName} — Cerebro humanoide`,
  description:
    "Cerebro conversacional cloud para robot humanoide. Voz en tiempo real. Sin control físico conectado todavía.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05070c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
