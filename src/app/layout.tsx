import type { ReactNode } from "react";

export const metadata = { title: "Momentum-Value Screener" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#f3f4f6", color: "#111827" }}>
        <main style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
