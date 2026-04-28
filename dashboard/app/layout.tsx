import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "x402 Private Gateway",
  description:
    "Privacy-preserving x402 payments powered by Arcium MPC — verify payments without revealing wallet addresses, amounts, or API access patterns.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
