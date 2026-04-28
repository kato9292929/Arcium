export interface PublicTransaction {
  signature: string;
  sender: string;
  recipient: string;
  amount: string;
  endpoint: string;
  timestamp: string;
}

export interface PrivateVerification {
  payment_valid: boolean;
  sender: string;
  amount: string;
  endpoint: string;
  arciumProof: string;
  privacyMode: "mock" | "mpc";
}

export interface DemoTriggerResponse {
  publicObservable: PublicTransaction;
  privateVerified: PrivateVerification;
  comparison: {
    publicExposes: string[];
    privateExposes: string[];
    hiddenByArcium: string[];
  };
}

export interface FeedEntry {
  id: string;
  type: "public" | "private";
  data: PublicTransaction | PrivateVerification;
  receivedAt: string;
}
