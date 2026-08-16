import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magnetic Load and Haul Shiftboard",
  description: "Drag-and-drop magnetic shiftboard for Load and Haul operations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
