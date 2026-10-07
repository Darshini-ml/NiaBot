import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono, Playfair_Display, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "NiaAI - Intelligent Assistant",
  description: "AI-powered chatbot with multimodal capabilities",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} ${instrumentSerif.variable} h-full`}>
      <body className="h-full overflow-hidden" suppressHydrationWarning>
        <Script id="theme-init" strategy="beforeInteractive">{`(function(){var t=localStorage.getItem('nia-theme');document.documentElement.setAttribute('data-theme',t||'dark')})()`}</Script>
        {children}
      </body>
    </html>
  );
}
