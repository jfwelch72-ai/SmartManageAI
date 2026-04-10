import { registerProvider } from "../registry";
import { qboProvider } from "./qbo";
import { googleProvider } from "./google";
import { microsoftProvider } from "./microsoft";
import { esignProvider } from "./esign";
import { zapierProvider } from "./zapier";
import { dropboxProvider } from "./dropbox/provider";
import { gdriveProvider } from "./gdrive/provider";
import { onedriveProvider } from "./onedrive/provider";
import { boxProvider } from "./box/provider";
import { stackctProvider } from "./stackct";

export function registerAllProviders() {
  registerProvider(qboProvider);
  registerProvider(googleProvider);
  registerProvider(microsoftProvider);
  registerProvider(esignProvider);
  registerProvider(zapierProvider);
  registerProvider(dropboxProvider);
  registerProvider(gdriveProvider);
  registerProvider(onedriveProvider);
  registerProvider(boxProvider);
  registerProvider(stackctProvider);
}
