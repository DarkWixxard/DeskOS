import type { Metadata, Viewport } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "DeskOS Dashboard",
  description: "Modular Monitoring & Control System",
};

// Report the real device width so the dashboard renders 1:1 on small touch
// panels (e.g. fixed-mount 7" displays, 800×480 / 1024×600) instead of at a
// desktop viewport. `themeColor` matches the dark holo background so the
// browser chrome blends in on a kiosk display.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f0f0f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-dark text-white">
        {children}
      </body>
    </html>
  );
}
