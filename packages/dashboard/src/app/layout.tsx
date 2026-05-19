import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sentient Alpha — AI Trading Agent Dashboard",
  description: "Autonomous AI trading agent on Mantle L2 with ERC-8004 identity",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: "#0a0b0d",
        color: "#e4e4e7",
        minHeight: "100vh",
      }}>
        {children}
      </body>
    </html>
  );
}
