# Endpoint Management Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Review cadence | Annual |

## 1. Scope

All laptops and desktops used by employees and contractors to access
Company information assets (the "Service", source code, customer data,
or sensitive internal systems).

## 2. Baseline configuration

Every in-scope endpoint must:

- Be enrolled in the Company **MDM** (and the Vanta endpoint agent).
- Be running a vendor-supported operating system version, with
  automatic security updates enabled.
- Have **full-disk encryption** turned on (FileVault / BitLocker, AES-256).
- Have **screen lock** after at most 10 minutes of inactivity, with a
  password or biometric required to unlock.
- Run **EDR / anti-malware** with real-time protection enabled.
- Use the password manager (no passwords in browser keychains for
  Restricted-tier credentials).
- Use a supported browser kept up-to-date.

## 3. Personal devices (BYOD)

- **Production source, customer data, or production credentials may not
  be stored on personal devices.**
- Email and Slack are allowed on personal mobile devices via the managed
  app configuration, which enforces app-level PIN/biometric and remote
  wipe.

## 4. Provisioning

- New laptops are imaged with the baseline before being shipped to the
  employee.
- The employee acknowledges this policy as part of onboarding.
- Recovery keys for disk encryption are escrowed in MDM.

## 5. Loss / theft

Report immediately to security@ and the IR on-call. Lost devices are
remote-wiped via MDM as soon as they appear online. The incident is
tracked under the IR policy.

## 6. Off-boarding

- Returned hardware is wiped before re-issue.
- For remote staff, MDM-issued remote-wipe is triggered before the
  laptop is shipped back.

## 7. Compliance monitoring

Vanta continuously checks for: encryption, screen lock, OS up-to-date,
EDR running. Devices out of compliance for more than 7 days are blocked
from production system access.
