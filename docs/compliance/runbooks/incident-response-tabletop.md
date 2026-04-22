# Incident Response Tabletop Drill

| Owner | CTO |
| ----- | --- |
| Cadence | At least annually |
| Duration | 60–90 minutes |

This document drives the annual tabletop exercise required by policy #04.
The goal is to walk through the IR plan against a realistic scenario,
without touching production, and surface gaps in the plan, tooling, or
team readiness.

## Roles for the drill

- **Facilitator** — does not respond; runs the scenario, injects new
  information, takes notes.
- **Incident Commander** — actual on-call IC for the quarter, drives
  the response.
- **Responders** — actual on-call engineers, security, and comms.
- **Observer** — at least one engineer not in the on-call rotation; their
  role is to write down everything that was unclear.

## Logistics

- Schedule for 90 minutes.
- Block all participants' calendars; treat as if production was down.
- Use the real `#incident-dr` Slack channel name with a `[DRILL]` prefix.
- Use the real status page in **draft** mode (do not publish).

## Scenarios (rotate yearly)

### Scenario A — credential compromise
> A staff laptop was stolen at an airport. The employee believes they
> were logged into the cloud console at the time. They reported it 2
> hours later.

Inject after 15 min: an unusual `SUPER_ADMIN` login from an unfamiliar
country shows up in the audit log.

Goal: exercise containment (revoke tokens via `revokeUserTokens`, rotate
secrets, lock IdP account), evidence preservation, customer notification
decision.

### Scenario B — exposed customer data
> Support receives an email from a security researcher with a screenshot
> showing a customer's project file pulled via a guessed object URL.

Goal: exercise verification, scope of exposure, ACL review
(`server/objectAcl.ts`), customer notification timing, public response.

### Scenario C — production outage with potential data loss
> Primary database has been unreachable for 20 minutes. Last backup
> validated successfully 6 hours ago.

Goal: exercise the DR runbook decision (Option A vs B), comms cadence,
RTO/RPO commitments.

### Scenario D — sub-processor breach
> A sub-processor (e.g. our email vendor) discloses a breach affecting
> contact data; we are listed as an affected customer.

Goal: exercise vendor management interaction, customer comms,
sub-processor list update.

## Drill checklist

- [ ] Scenario chosen and not previewed by the responders
- [ ] Facilitator opens the drill with: severity, time of detection,
      what is known, what alarms have fired
- [ ] IC declares severity, opens timeline, opens channel
- [ ] Containment action discussed and decision recorded
- [ ] Customer comms drafted (do not send)
- [ ] Status page update drafted (do not publish)
- [ ] Hand-off / shift change rehearsed once
- [ ] Recovery / "all clear" decision made
- [ ] Retro held at the end

## Output

File in `docs/compliance/evidence/YYYY-MM-DD-ir-tabletop.md` with:
- Date, scenario chosen, attendees
- Timeline of decisions
- Gaps surfaced
- Action items (owner + due date)
- Sign-off by IC and CTO

Action items are tracked to closure in the GRC platform.
