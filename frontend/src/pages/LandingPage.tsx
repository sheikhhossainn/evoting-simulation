import { Link } from "react-router-dom";

/* ── Role card data ── */
const roles = [
  {
    id: "voter-card",
    tag: "VOTER PORTAL",
    title: "I am a Voter",
    description:
      "Authenticate with your NID, select your constituency's candidate, and cast a cryptographically verifiable ballot.",
    link: "/voter/login",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    ),
    tagColor: "#006A4E",
  },
  {
    id: "admin-card",
    tag: "ELECTION COMMISSION",
    title: "I am an Admin",
    description:
      "Manage candidates and constituencies, monitor voting activity, and control the election lifecycle.",
    link: "/admin/login",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
    tagColor: "#C8920A",
  },
  {
    id: "keyholder-card",
    tag: "DECRYPTION AUTHORITY",
    title: "I am a Key Holder",
    description:
      "Submit your Shamir secret share to participate in 3‑of‑4 threshold decryption of the final tally.",
    link: "/keyholder/login",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
      </svg>
    ),
    tagColor: "#486581",
  },
] as const;

const LandingPage = () => {
  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ── Hero Section ── */}
      <section className="px-4 pb-4 pt-16 text-center sm:pt-20">
        {/* Badge */}
        <div className="mb-6 flex items-center justify-center">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{
              color: "#C8920A",
              background: "rgba(200, 146, 10, 0.08)",
              border: "1px solid rgba(200, 146, 10, 0.15)",
            }}
          >
            <span
              className="h-px flex-1"
              style={{ width: "2rem", background: "rgba(200, 146, 10, 0.3)" }}
            />
            Blockchain‑Secured · ElGamal Encrypted
            <span
              className="h-px flex-1"
              style={{ width: "2rem", background: "rgba(200, 146, 10, 0.3)" }}
            />
          </div>
        </div>

        {/* Heading */}
        <h1
          className="mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:text-5xl"
          style={{ color: "#0A2540" }}
        >
          National Digital Election System
        </h1>

        {/* Subtitle */}
        <p
          className="mx-auto mt-4 max-w-2xl text-base leading-relaxed sm:text-lg"
          style={{ color: "#627d98" }}
        >
          A cryptographically verifiable e‑voting simulation. Ballots are
          ElGamal‑encrypted, decryption requires distributed key
          reconstruction, and every step is publicly auditable.
        </p>
      </section>

      {/* ── Role Cards ── */}
      <section className="mx-auto grid max-w-5xl gap-5 px-4 pb-8 pt-8 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <Link
            key={role.id}
            to={role.link}
            id={role.id}
            className="glass-card group flex flex-col p-6 no-underline transition-transform duration-300 hover:-translate-y-1"
          >
            {/* Icon */}
            <div
              className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl text-white"
              style={{ background: "#0A2540" }}
            >
              {role.icon}
            </div>

            {/* Tag */}
            <p
              className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em]"
              style={{ color: role.tagColor }}
            >
              {role.tag}
            </p>

            {/* Title */}
            <h2
              className="mb-2 text-lg font-semibold"
              style={{ color: "#0A2540" }}
            >
              {role.title}
            </h2>

            {/* Description */}
            <p
              className="mb-5 flex-1 text-sm leading-relaxed"
              style={{ color: "#627d98" }}
            >
              {role.description}
            </p>

            {/* Enter link */}
            <div
              className="flex items-center gap-1 text-sm font-medium transition-colors group-hover:gap-2"
              style={{ color: "#0A2540" }}
            >
              Enter
              <svg
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </Link>
        ))}
      </section>

      {/* ── Results link (placeholder) ── */}
      <section className="pb-12 text-center">
        <button
          disabled
          className="inline-flex items-center gap-1.5 text-sm font-medium opacity-50 cursor-not-allowed"
          style={{ color: "#006A4E" }}
        >
          View Public Results &amp; Audit Log
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
        <p className="mt-1 text-xs" style={{ color: "#9fb3c8" }}>
          Available after election is completed
        </p>
      </section>
    </div>
  );
};

export default LandingPage;
