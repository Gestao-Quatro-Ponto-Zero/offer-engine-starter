import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G4 Offers — Condições de Pagamento Inteligentes",
  description: "Sistema de oferta de condições de pagamento risk-based",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
