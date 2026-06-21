// No ambient module declaration is needed right now: the gateway does not import
// any Arcium SDK. The previous stub here declared `@arcium-hq/arcium-js`, which
// does NOT exist on npm and was never installed.
//
// When the real path in src/lib/arcium.ts is implemented, depend on the actual
// Arcium TypeScript SDK instead — `@arcium-hq/client` (and `@arcium-hq/reader`),
// which ship their own types — and delete this placeholder.
// Docs: https://ts.arcium.com/

export {};
