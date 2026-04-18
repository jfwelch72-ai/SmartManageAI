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
import { aashtowareProvider } from "./aashtoware";
import { dolDavisBaconProvider } from "./dol_davis_bacon";
import { dbeDirectoryProvider } from "./dbe_directory";
import { suretyVerificationProvider } from "./surety_verification";

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
  registerProvider(aashtowareProvider);
  registerProvider(dolDavisBaconProvider);
  registerProvider(dbeDirectoryProvider);
  registerProvider(suretyVerificationProvider);
}
