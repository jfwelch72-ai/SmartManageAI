# Information Security Policy

| Owner | CTO |
| ----- | --- |
| Approver | CEO |
| Effective | On commit (see git history) |
| Review cadence | Annual, or on material change |

## 1. Purpose

Establish the management direction for information security at SmartManageAI
(the "Company") in support of business requirements, customer commitments,
and applicable laws and regulations.

## 2. Scope

This policy applies to:

- All employees, contractors, and interns of the Company.
- All systems that store, process, or transmit customer data, including the
  production application, supporting infrastructure, and corporate
  endpoints.
- All third-party providers acting as sub-processors (see
  `sub-processors.md`).

## 3. Policy

The Company commits to:

1. Protecting the **confidentiality, integrity, and availability** of
   customer and Company information.
2. Operating an information security management program aligned with the
   AICPA Trust Services Criteria and, over time, ISO/IEC 27001.
3. Maintaining the supporting policies in `docs/compliance/policies/`,
   reviewing each one at least annually.
4. Performing a documented **risk assessment** at least annually; results
   are filed in `docs/compliance/evidence/`.
5. Providing **security awareness training** to every employee on hire and
   annually thereafter.
6. Reporting and responding to security incidents per the Incident Response
   Policy (#04).
7. Continuously monitoring controls via the GRC platform (Vanta) and
   triaging findings within the SLAs defined in policy #11.

## 4. Roles and responsibilities

| Role | Responsibility |
| ---- | -------------- |
| CEO | Final accountability for the security program; approves policies. |
| CTO / Head of Security | Owns the program; chairs the security review meeting; approves exceptions. |
| Engineering managers | Ensure their teams comply with the SDLC, change management, and access control policies. |
| All staff | Read, acknowledge, and follow these policies; report incidents. |

## 5. Exceptions

Exceptions must be requested in writing, approved by the CTO, time-bound
(maximum 90 days), and tracked in the GRC platform.

## 6. Enforcement

Violations may result in disciplinary action up to and including termination,
and may be reported to law enforcement where required by law.
