// Manual integration smoke test against a real LiteLLM proxy.
// Reads credentials from env (LITELLM_BASE_URL, LITELLM_API_KEY).
// Run: npx tsx scripts/smoke.ts
//
// Prints discovered models. Does not write to the cache file.

import { discoverModels, normalizeBaseUrl } from "../src/discover.js";

async function main(): Promise<void> {
  const baseUrl = process.env.LITELLM_BASE_URL?.trim();
  const apiKey = process.env.LITELLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    console.error("LITELLM_BASE_URL and LITELLM_API_KEY must be set.");
    process.exit(2);
  }
  const result = await discoverModels(normalizeBaseUrl(baseUrl), apiKey, {
    timeoutMs: 10_000,
  });
  console.log(`Source: ${result.source}`);
  console.log(`Discovered ${result.models.length} models:`);
  for (const m of result.models) {
    console.log(`  - ${m.id}  (ctx=${m.contextWindow}, max=${m.maxTokens}, compat=${JSON.stringify(m.compat)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
