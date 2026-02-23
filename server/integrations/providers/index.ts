import { registerProvider } from "../registry";
import { qboProvider } from "./qbo";
import { googleProvider } from "./google";
import { microsoftProvider } from "./microsoft";
import { esignProvider } from "./esign";
import { zapierProvider } from "./zapier";

export function registerAllProviders() {
  registerProvider(qboProvider);
  registerProvider(googleProvider);
  registerProvider(microsoftProvider);
  registerProvider(esignProvider);
  registerProvider(zapierProvider);
}
