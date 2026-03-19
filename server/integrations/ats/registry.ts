import type { ATSProvider } from "./ATSProvider";
import { WorkableProvider } from "./WorkableProvider";
import { GreenhouseProvider } from "./GreenhouseProvider";
import { LeverProvider } from "./LeverProvider";

const providers: Map<string, ATSProvider> = new Map([
  ["WORKABLE", new WorkableProvider()],
  ["GREENHOUSE", new GreenhouseProvider()],
  ["LEVER", new LeverProvider()],
]);

export function getATSProvider(providerName: string): ATSProvider | null {
  return providers.get(providerName.toUpperCase()) ?? null;
}

export function listATSProviders(): string[] {
  return Array.from(providers.keys());
}
