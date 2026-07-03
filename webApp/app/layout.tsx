import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: "600",
  variable: "--fontDisplay",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--fontBody",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dicci Group Finance",
  description: "Income reconciliation across Dicci Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
