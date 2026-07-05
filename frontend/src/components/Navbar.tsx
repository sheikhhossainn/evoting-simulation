import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

const navLinks = [
  { label: "Home", path: "/" },
  { label: "How to Vote", path: "/how-to-vote" },
  { label: "Watchdog", path: "/watchdog" },
  { label: "About", path: "/about" },
] as const;

export default function Navbar() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      id="main-navbar"
      className="sticky top-0 z-50 w-full border-b"
      style={{
        background: "#0A2540",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* ── Brand ── */}
        <Link
          to="/"
          id="navbar-brand"
          className="flex items-center gap-2.5 text-white no-underline"
        >
          {/* Shield / vote icon */}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgba(0, 106, 78, 0.5)" }}
          >
            <svg
              className="h-4 w-4 text-emerald-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold tracking-tight">
              SecureVote
            </span>
            <span className="hidden text-[11px] font-medium uppercase tracking-widest text-slate-400 sm:inline">
              National Election Commission
            </span>
          </div>
        </Link>

        {/* ── Desktop nav links ── */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                id={`nav-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* ── Mobile hamburger ── */}
        <button
          id="mobile-menu-toggle"
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:hidden"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile dropdown ── */}
      {mobileOpen && (
        <div className="border-t border-white/5 px-4 pb-4 pt-2 md:hidden">
          {navLinks.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileOpen(false)}
                className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
