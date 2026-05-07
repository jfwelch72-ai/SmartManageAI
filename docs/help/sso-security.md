# Enable SSO and security policies

SAML / OIDC SSO, password policy, MFA, and session controls.

## How to do it

1. Open *Company Settings → Security → SSO*.
1. Pick your IdP (Okta, Azure AD, Google Workspace, generic SAML/OIDC).
1. Paste the metadata URL or upload the metadata XML. Map IdP groups to SmartManageAI roles.
1. Test with *Run SSO test*. Once passing, flip *Require SSO for all users* — non-SSO logins are rejected from then on.

## Tips

- MFA, password length, and session timeout are configured under *Security → Policies* — independently of SSO for orgs that don't use SSO.

---

Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
