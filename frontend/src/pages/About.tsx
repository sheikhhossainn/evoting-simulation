/**
 * About.tsx
 *
 * Project overview, technology stack, and academic context.
 * Educational page — no logic, pure content.
 */

const techStack = [
  {
    name: "ElGamal Encryption",
    category: "Vote Privacy",
    description:
      "Homomorphic encryption scheme that encrypts each ballot client-side. Votes can be aggregated in ciphertext form — no single entity ever sees a decrypted ballot.",
  },
  {
    name: "Zero-Knowledge Proofs",
    category: "Identity Verification",
    description:
      "Proves a voter is eligible without revealing their identity. The voter's NID is hashed (SHA-256) and verified via a nullifier — the raw NID never leaves the browser.",
  },
  {
    name: "Shamir's Secret Sharing",
    category: "Decryption Authority",
    description:
      "The private decryption key is split into 4 shares. Any 3 key holders must collaborate to reconstruct it — preventing any single authority from accessing results alone.",
  },
  {
    name: "Polygon Blockchain",
    category: "Immutability",
    description:
      "Each confirmed vote's hash is anchored on the Polygon PoS chain, creating a tamper-proof audit trail that anyone can independently verify.",
  },
];

export default function About() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)]" style={{ background: "#F2F5FA" }}>
      {/* ── Header ── */}
      <section className="px-4 pb-4 pt-14 text-center sm:pt-16">
        <h1
          className="text-3xl font-bold tracking-tight sm:text-4xl"
          style={{ color: "#0A2540" }}
        >
          About This Project
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed" style={{ color: "#627d98" }}>
          SecureVote BD is an academic research simulation exploring how modern
          cryptographic protocols can enable secure, transparent, and verifiable
          electronic elections for Bangladesh.
        </p>
      </section>

      {/* ── Mission ── */}
      <section className="mx-auto max-w-3xl px-4 pb-8 pt-6">
        <div className="glass-card p-6 sm:p-8">
          <h2
            className="mb-3 text-lg font-bold"
            style={{ color: "#0A2540" }}
          >
            Why This Matters
          </h2>
          <div className="space-y-3 text-sm leading-relaxed" style={{ color: "#627d98" }}>
            <p>
              Traditional paper-based elections face challenges: long queues,
              counting errors, accessibility barriers, and limited
              transparency. Digital voting solves these — but introduces new
              risks around privacy, tampering, and trust.
            </p>
            <p>
              This simulation demonstrates that it's possible to have{" "}
              <strong style={{ color: "#0A2540" }}>
                both convenience and security
              </strong>
              . Using a combination of encryption, zero-knowledge proofs,
              secret sharing, and blockchain anchoring, we achieve:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <strong style={{ color: "#0A2540" }}>Ballot secrecy</strong> — no one can see your vote
              </li>
              <li>
                <strong style={{ color: "#0A2540" }}>Verifiability</strong> — you can confirm your vote was counted
              </li>
              <li>
                <strong style={{ color: "#0A2540" }}>One-person-one-vote</strong> — cryptographically enforced
              </li>
              <li>
                <strong style={{ color: "#0A2540" }}>Transparent tallying</strong> — auditable by the public
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Technology Stack ── */}
      <section
        className="border-t px-4 pb-14 pt-10"
        style={{ borderColor: "rgba(10, 37, 64, 0.06)" }}
      >
        <h2
          className="mb-6 text-center text-xl font-bold tracking-tight sm:text-2xl"
          style={{ color: "#0A2540" }}
        >
          Cryptographic Stack
        </h2>
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {techStack.map((tech) => (
            <div key={tech.name} className="glass-card p-5">
              <p
                className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em]"
                style={{ color: "#C8920A" }}
              >
                {tech.category}
              </p>
              <h3
                className="mb-2 text-base font-semibold"
                style={{ color: "#0A2540" }}
              >
                {tech.name}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "#627d98" }}>
                {tech.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Disclaimer ── */}
      <section className="mx-auto max-w-3xl px-4 pb-12">
        <div
          className="rounded-lg border p-4 text-center text-xs"
          style={{
            borderColor: "rgba(200, 146, 10, 0.2)",
            background: "rgba(200, 146, 10, 0.04)",
            color: "#856207",
          }}
        >
          <strong>Academic Simulation</strong> — This project is for research
          and educational purposes. It is not affiliated with any government
          body and should not be used for actual elections.
        </div>
      </section>
    </div>
  );
}
