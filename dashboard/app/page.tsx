import { ComparisonView } from "@/components/ComparisonView";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold">
              x
            </div>
            <span className="font-semibold text-slate-100">x402 Private Gateway</span>
            <span className="text-xs bg-violet-900 text-violet-300 px-2 py-0.5 rounded-full">
              Powered by Arcium MPC
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <a
              href="https://github.com/kato9292929/arcium"
              className="hover:text-slate-200 transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://x402.org"
              className="hover:text-slate-200 transition-colors"
            >
              x402 spec
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 py-12 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">
          API Payments. No On-Chain Exposure.
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto text-base">
          Standard x402 broadcasts who paid, how much, and which API they accessed.{" "}
          <strong className="text-slate-200">x402 Private Gateway</strong> uses Arcium&apos;s
          MPC network to verify payment validity inside an encrypted computation — only a
          single boolean exits the cluster.
        </p>

        {/* Privacy guarantee chips */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {[
            { icon: "🔒", label: "Sender wallet hidden" },
            { icon: "🔒", label: "Amount hidden" },
            { icon: "🔒", label: "Endpoint hidden" },
            { icon: "🔒", label: "Access frequency hidden" },
            { icon: "✓", label: "Payment validity provable" },
          ].map(({ icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full text-xs text-slate-300"
            >
              <span>{icon}</span>
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <div className="bg-red-950/40 border border-red-900 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-red-300 mb-2">Standard x402 (public)</h3>
            <code className="text-xs text-slate-300 block leading-relaxed">
              Agent → 402 →{" "}
              <span className="text-red-400">USDC transfer (visible on-chain)</span>{" "}
              → API access
            </code>
            <p className="text-xs text-slate-500 mt-2">
              Sender, amount, and endpoint are permanently visible to anyone indexing
              Solana.
            </p>
          </div>
          <div className="bg-violet-950/40 border border-violet-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-violet-300 mb-2">
              x402 Private Gateway (private)
            </h3>
            <code className="text-xs text-slate-300 block leading-relaxed">
              Agent → 402 →{" "}
              <span className="text-violet-400">Arcium MXE verifies (hidden)</span>{" "}
              → API access
            </code>
            <p className="text-xs text-slate-500 mt-2">
              Only <code className="text-emerald-400">payment_valid: true</code> exits the
              MPC cluster. Everything else stays encrypted.
            </p>
          </div>
        </div>
      </section>

      {/* Live demo */}
      <section className="max-w-6xl mx-auto px-4 pb-16">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-100">Live Demo</h2>
          <p className="text-sm text-slate-400 mt-1">
            Click &ldquo;Trigger Payment&rdquo; to fire a test transaction through both flows
            simultaneously and observe the difference in real time.
          </p>
        </div>
        <ComparisonView />
      </section>

      {/* Architecture */}
      <section className="border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <h2 className="text-lg font-semibold text-slate-100 mb-6">Architecture</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: "Cloudflare Worker",
                tech: "Hono.js + TypeScript",
                desc: "Edge gateway that handles x402 402/payment flow, fetches transactions via Helius, and routes to the Arcium MXE.",
              },
              {
                title: "Arcium MXE",
                tech: "Rust + Arcis DSL",
                desc: "Multi-party encrypted computation. Receives encrypted sender, amount, mint. Returns only payment_valid boolean — inputs never leave the cluster.",
              },
              {
                title: "Solana + USDC",
                tech: "Helius RPC",
                desc: "Payment settlement chain. Helius Enhanced Transactions API parses raw transfers. Replay prevention via KV with 24h TTL.",
              },
            ].map(({ title, tech, desc }) => (
              <div key={title} className="bg-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
                <p className="text-xs text-violet-400 mt-0.5 mb-2">{tech}</p>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        x402 Private Gateway — built with Arcium MPC · Solana · Cloudflare Workers
      </footer>
    </main>
  );
}
