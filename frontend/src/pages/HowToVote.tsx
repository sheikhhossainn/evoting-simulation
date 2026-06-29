/**
 * HowToVote.tsx
 *
 * Step-by-step guide explaining the voting process.
 * Educational page — no logic, pure content.
 */

const steps = [
  {
    step: 1,
    title: "Verify Your Identity",
    description:
      "Enter your 11-digit National ID (NID). Your identity is verified using Zero-Knowledge Proofs — your NID is never stored in plaintext. Only a SHA-256 hash is used.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    ),
  },
  {
    step: 2,
    title: "Select Your Candidate",
    description:
      "You'll see the candidates standing in your constituency. Select your preferred candidate. Each constituency has its own ballot.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
      </svg>
    ),
  },
  {
    step: 3,
    title: "Your Vote Is Encrypted",
    description:
      "Your vote is encrypted using the ElGamal encryption scheme before leaving your browser. No one — not even the server — can see your choice in plaintext.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
    ),
  },
  {
    step: 4,
    title: "Blockchain Anchoring",
    description:
      "Your encrypted vote is anchored on the Polygon blockchain. This creates an immutable, publicly auditable record that can never be altered or deleted.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
      </svg>
    ),
  },
  {
    step: 5,
    title: "Receive Confirmation",
    description:
      "You receive a vote confirmation receipt with a unique transaction hash. Use it to verify your vote was included in the final tally — without revealing your choice.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
];

const securityFeatures = [
  {
    title: "Zero-Knowledge Proofs",
    description: "Verify your identity without exposing personal data",
  },
  {
    title: "ElGamal Encryption",
    description: "Votes are encrypted client-side, unreadable on the server",
  },
  {
    title: "Shamir's Secret Sharing",
    description: "Decryption requires 3-of-4 key holders — no single authority",
  },
  {
    title: "Polygon Blockchain",
    description: "Immutable vote records, publicly auditable by anyone",
  },
];

export default function HowToVote() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ── Header ── */}
      <section className="px-4 pb-4 pt-14 text-center sm:pt-16">
        <h1
          className="text-3xl font-bold tracking-tight sm:text-4xl"
          style={{ color: "#0A2540" }}
        >
          How to Vote
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base" style={{ color: "#627d98" }}>
          Casting your vote takes under 2 minutes. Here's what happens at each
          step — and how your vote stays secure.
        </p>
      </section>

      {/* ── Steps ── */}
      <section className="mx-auto max-w-3xl px-4 pb-12 pt-6">
        <div className="space-y-4">
          {steps.map((s) => (
            <div
              key={s.step}
              className="glass-card flex gap-4 p-5 sm:gap-5 sm:p-6"
            >
              {/* Step number + icon */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white"
                  style={{ background: "#0A2540" }}
                >
                  {s.icon}
                </div>
                <span
                  className="text-xs font-bold"
                  style={{ color: "#9fb3c8" }}
                >
                  {s.step}/5
                </span>
              </div>

              {/* Content */}
              <div className="min-w-0">
                <h3
                  className="text-base font-semibold sm:text-lg"
                  style={{ color: "#0A2540" }}
                >
                  {s.title}
                </h3>
                <p
                  className="mt-1 text-sm leading-relaxed"
                  style={{ color: "#627d98" }}
                >
                  {s.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Security Features ── */}
      <section
        className="border-t px-4 pb-14 pt-10"
        style={{ borderColor: "rgba(10, 37, 64, 0.06)" }}
      >
        <h2
          className="mb-6 text-center text-xl font-bold tracking-tight sm:text-2xl"
          style={{ color: "#0A2540" }}
        >
          Security at Every Layer
        </h2>
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {securityFeatures.map((feat) => (
            <div
              key={feat.title}
              className="glass-card p-5"
            >
              <h4
                className="text-sm font-semibold"
                style={{ color: "#006A4E" }}
              >
                {feat.title}
              </h4>
              <p
                className="mt-1 text-sm"
                style={{ color: "#627d98" }}
              >
                {feat.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
