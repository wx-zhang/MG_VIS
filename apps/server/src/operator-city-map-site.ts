import type { MarlowGreenMapSite } from "@tyr-ai/contracts";
// Provisioned identities are used only to bind this demo's scenery. This never grants access.
const SITES: Record<string, MarlowGreenMapSite> = {
  "dorian-mg@tyr.ai": "dorian",
  "mira-mg@tyr.ai": "mira",
  "tomas-mg@tyr.ai": "tomas",
  "market-mg@tyr.ai": "marketplace",
  "sable-mg@tyr.ai": "sable",
  "bank-mg@tyr.ai": "bank",
};
export function operatorCityMapSite(
  ownerEmail: string | undefined,
): MarlowGreenMapSite | undefined {
  const key = ownerEmail?.toLowerCase();
  return key && Object.hasOwn(SITES, key) ? SITES[key] : undefined;
}
