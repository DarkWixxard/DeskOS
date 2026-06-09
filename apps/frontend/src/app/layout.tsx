import type { Metadata } from "next";
import "../globals.css";

export const metadata: Metadata = {
  title: "DeskOS Dashboard",
  description: "Modular Monitoring & Control System",
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
