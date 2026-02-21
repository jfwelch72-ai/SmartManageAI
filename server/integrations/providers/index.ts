import { registerProvider } from "../registry";
import { qboProvider } from "./qbo";
import { googleProvider } from "./google";
import { microsoftProvider } from "./microsoft";
import { esignProvider } from "./esign";

export function registerAllProviders() {
  registerProvider(qboProvider);
  registerProvider(googleProvider);
  registerProvider(microsoftProvider);
  registerProvider(esignProvider);
}
