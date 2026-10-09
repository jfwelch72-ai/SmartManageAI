# SMA-SEC-001 — Obfuscated blockchain-C2 loader injected into `postcss.config.js` (CRITICAL)

Category: Observed repository compromise (static evidence + runtime parse failure). Severity: Critical. Priority: P0.
Detected: 2026-10-09T12:03Z (UTC) during QA run SMA-QA-20261009T120012Z, local boot of `npm run dev` equivalent.

## Evidence
- File: `postcss.config.js` line 10 (53,923 chars). It begins `};` followed by hundreds of spaces, which pushes the obfuscated code off-screen in editors and diff viewers. The code is a function `GSkqNNyuJw$_padNcYwam` with a hex string table XOR-encoded with key `0xC9`.
- File SHA-256 at HEAD: `4a37e4146bbc2fb89528de59b558670223fdf3510ce4e8217cd4a22bd17d39a2`.
- Introduced by commit `1378776f003dd7463af6aa3bdbe2a7e7a1bd7b19`. Author `jhanjay09 <40051334-jhanjay09@users.noreply.replit.com>`, 2026-08-04 21:51:59Z. Commit message: "Add role-specific contextual help panel accessible from every page".
  - The same commit added `.gitignore` entries `branch_structure.json`, `temp_auto_push.bat` and `temp_interactive_push.bat`. These are consistent with an automated pusher running on a compromised Windows workstation (hypothesis).
  - The parent version (`a77912a`) is a clean 6-line config.
- Present on `main`, `origin/main` and `claude/brave-brahmagupta-mx5ti1`. A history search (`git log --all -S GSkqNNyuJw`) finds only this one introducing commit. No other tracked code or config file has an equivalent long hidden line.

## Decoded indicators (static XOR decode only; the JavaScript was never executed by QA)
- Ethereum address `0xa322E5f3D311D3080e6f0121063e9aDC2490Ef1a`. The loader reads its transaction list to fetch the next stage ("EtherHiding"-style dead drop).
- RPC/explorer endpoints: `https://1rpc.io/eth`, `https://eth.drpc.org`, `https://eth.blockscout.com/api`, `https://ethereum-rpc.publicnode.com`, `https://eth-mainnet.public.blastapi.io`, `ETH_RPC_URL` env override. It also references the paths `:443/0x/ls` and `:443/0x/cls`.
- Capabilities referenced: `node:child_process`, `node:https`, `node:http`, `node:zlib` (`createGunzip`, `createInflate`), `global['r']=require; global['m']=module`, `global['_V']`, `_H`, `_H2`, `_t_s`, `_t_u`, and a spoofed Chrome 131 Windows User-Agent.
- Assessment: a remote-code loader that runs whenever any Vite/PostCSS tooling loads the config (`npm run dev`, `npm run build`, `vitest`, Playwright webServer, CI, Amplify build).

## Runtime observation in this environment
Vite failed to load the config with `SyntaxError: Identifier 'createRequire' has already been declared` (first-boot server log lines 29–40 and 228–230; transcribed during the session. That log file was overwritten by the clean restart, so the excerpt below is the only copy). An ES module that fails to parse does not execute. The agent proxy recorded no relay failures to the listed RPC hosts, and the server log has no references to them. Under other loaders or Node versions, or with a slightly modified variant, the payload could execute. Its effect on the hosted Amplify build is UNVERIFIED (the host is unreachable from this environment).

Excerpt (first boot, 2026-10-09T12:02:50Z):
```
[ERROR] Unhandled promise rejection | Error: Failed to load PostCSS config (searchPath: /home/user/SmartManageAI/client): [SyntaxError] Identifier 'createRequire' has already been declared
    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
12:02:58 PM [vite] Pre-transform error: Failed to load PostCSS config ... [SyntaxError] Identifier 'createRequire' has already been declared
```
Local mitigation (2026-10-09T12:08Z, user-approved): the working-tree copy was restored to the clean `a77912a` version and is NOT committed. All QA results in this run were produced with that clean config.

## Recommended response (owners: security + DevOps; not performed by QA)
1. Remove the line and restore the clean config. Block merges until done. Treat any machine or CI runner that ran `npm run dev/build/test` since 2026-08-04 as potentially compromised.
2. Rotate secrets reachable from those machines and runners: GitHub/Replit tokens, AWS/Amplify credentials, DATABASE_URL, SESSION_SECRET, Anthropic/OpenAI/SendGrid/Stripe/QBO/Sage keys, SSH keys, and browser-stored crypto wallets.
3. Investigate the `jhanjay09` workstation and account. Review that account's other commits (2190c15, 2b11c49, ed71e17, cdcf4bc, ce02bf8, 57d12d1, a96bdad, 6c3d9c1, 094f665). Review Amplify build logs since 2026-08-04 for outbound calls to the endpoints above.
4. Add CI guards: a max-line-length/whitespace-padding check on config files, plus a secret/malware scan (the existing Security Gate did not stop this).
Regression acceptance: `postcss.config.js` matches the clean form; `git grep -n GSkqNNyuJw` returns nothing; CI includes a hidden-payload check.
