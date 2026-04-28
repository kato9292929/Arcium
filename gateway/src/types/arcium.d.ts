// Ambient type stub for @arcium-hq/arcium-js — replaced by real types when SDK publishes.
declare module "@arcium-hq/arcium-js" {
  export class ArciumClient {
    constructor(opts: { apiKey: string });
    encrypt(data: Uint8Array): Promise<string>;
    executeMXE(
      mxeId: string,
      inputs: Record<string, unknown>,
    ): Promise<{
      output: { payment_valid: boolean };
      computationId: string;
      clusterSignature: string;
    }>;
  }
}
