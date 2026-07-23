import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { CANONICAL_APP_ORIGIN } from "@/lib/public-domain";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_APP_ORIGIN),
  applicationName: "VantixApp",
  title: {
    default: "VantixApp",
    template: "%s · VantixApp",
  },
  description:
    "Gestión comercial, atención al cliente y automatización para negocios.",
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "VantixApp",
    url: CANONICAL_APP_ORIGIN,
    title: "VantixApp",
    description:
      "Gestión comercial, atención al cliente y automatización para negocios.",
  },
  twitter: {
    card: "summary",
    title: "VantixApp",
    description:
      "Gestión comercial, atención al cliente y automatización para negocios.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
