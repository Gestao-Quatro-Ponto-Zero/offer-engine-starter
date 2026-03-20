"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/rules", label: "Regras", icon: "⚙️" },
  { href: "/exceptions", label: "Exceções", icon: "🔓" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header
        style={{
          background: "var(--surface-primary)",
          borderBottom: "1px solid var(--border)",
          padding: "0 var(--space-6)",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <h1
            style={{
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            G4 Offers
          </h1>

          <nav style={{ display: "flex", gap: "var(--space-1)" }}>
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    padding: "var(--space-2) var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: isActive ? "var(--accent)" : "var(--text-secondary)",
                    background: isActive ? "var(--accent-light)" : "transparent",
                    textDecoration: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                  }}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          G4 Educação
        </div>
      </header>

      {/* Content */}
      <main
        style={{
          flex: 1,
          padding: "var(--space-6)",
          maxWidth: 1280,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {children}
      </main>
    </div>
  );
}
