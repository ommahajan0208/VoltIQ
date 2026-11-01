import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./globals.css";
import { Providers } from "@/components/providers";
export const metadata: Metadata = {
  title: {
    default: "VoltIQ",
    template: "%s · VoltIQ",
  },
  description:
    "Local-first household energy exploration, forecasting and candidate event review.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
