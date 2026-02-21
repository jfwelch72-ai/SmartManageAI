import type { IntegrationProvider } from "./types";

const providers = new Map<string, IntegrationProvider>();

export function registerProvider(provider: IntegrationProvider): void {
  providers.set(provider.key, provider);
}

export function getProvider(key: string): IntegrationProvider | undefined {
  return providers.get(key);
}

export function getAllProviders(): IntegrationProvider[] {
  return Array.from(providers.values());
}

export function getProviderKeys(): string[] {
  return Array.from(providers.keys());
}
