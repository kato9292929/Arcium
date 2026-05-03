export const runtime = "edge";

const PRICE_QUOTE = 1_000; // 0.001 USDC in base units

export async function POST(): Promise<Response> {
  const mockSig = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const publicObservable = {
    signature: mockSig,
    sender: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    recipient: process.env.PAYMENT_WALLET_ADDRESS ?? "GATEWAY_WALLET",
    amount: `${PRICE_QUOTE / 1_000_000} USDC`,
    endpoint: "/v1/price/BTC",
    timestamp: new Date().toISOString(),
  };

  const privateVerified = {
    payment_valid: true,
    sender: "[HIDDEN — encrypted inside Arcium MPC cluster]",
    amount: "[HIDDEN — encrypted inside Arcium MPC cluster]",
    endpoint: "[HIDDEN — not logged by gateway]",
    arciumProof: `demo-proof-${Date.now()}`,
    privacyMode: "mock",
  };

  return Response.json({
    publicObservable,
    privateVerified,
    comparison: {
      publicExposes: ["sender wallet", "exact amount", "API endpoint", "timestamp"],
      privateExposes: ["payment_valid boolean only"],
      hiddenByArcium: ["sender wallet", "exact amount", "API endpoint", "access frequency"],
    },
  });
}
