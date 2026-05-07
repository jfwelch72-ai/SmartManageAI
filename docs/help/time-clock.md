# Clock in / out and approve time

Field clocks in from the mobile app; managers approve weekly time on the web.

## How to do it

1. Field crew: open the mobile app → *Time clock* → tap *Clock in*. The app captures GPS, geofence status, and a face/badge photo if your org requires one.
1. During the shift, *Switch cost code* moves time between activities without clocking out.
1. *Clock out* at the end of the day. If the geofence wasn't satisfied, the entry is flagged for the manager.
1. Manager: open /time-clock-manager. Each user shows weekly hours bucketed by cost code.
1. Approve a row to push it into payroll; reject (with a reason) to send it back for the user to fix.

## Tips

- Overtime rules are configurable per-org (daily, weekly, or California-style 8/12) — set them under *Company Settings → Payroll rules*.
- Use *Bulk approve* to clear an entire crew once you've spot-checked the outliers.

## Troubleshooting

- **A clock-in is flagged for geofence violation but the user was on site** — check the project's geofence radius (defaults to 300 ft). Increase it or shift the centroid in *Project → Settings → Geofence*.

---

Need more help? Use the *?* widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
