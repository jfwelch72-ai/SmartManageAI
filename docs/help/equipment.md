# Track equipment and maintenance

The equipment module gives you a centralized asset register covering owned and rented machines, vehicles, and tools. Field staff log hours, fuel, and breakdowns from the mobile app; the system automatically debits costs to the project the equipment is assigned to and keeps maintenance schedules on track.

---

## Adding a piece of equipment

1. Navigate to **/equipment** in the sidebar.
1. Click **Add equipment**.
1. Fill in the required fields:
   - **Type** — machine category (e.g., Excavator, Concrete Pump, Pickup Truck, Compressor).
   - **Name / ID** — your internal asset number or a descriptive name (e.g., "CAT 336 #04").
   - **Serial number** — manufacturer's serial for warranty and registration tracking.
   - **Ownership** — choose **Owned** or **Rented**.
     - For rented equipment, set the **Rental end date**. The PM engine sends a reminder 7 days before this date automatically.
   - **Tracking type** — choose **Hours** (hour-meter), **Odometer** (miles/km), or **Both**.
   - **Starting reading** — current hour-meter or odometer value at the time of entry.
   - **Home location** — the yard or jobsite where the equipment normally lives.
   - **Cost code** — the default cost code for charges posted to a project.
1. Click **Save**.

> **Screenshot placeholder:** Add equipment drawer showing Type, Name, Serial, Ownership, Tracking type, and Starting reading fields.

---

## Assigning equipment to a project

Equipment costs flow to a project automatically when you make an assignment.

1. Open the equipment record and click **Assign to project**.
1. Choose the **Project** and the **Start date**.
1. Leave **End date** blank for an open-ended assignment, or set one if the equipment is only needed for a specific phase.
1. Click **Save**. Fuel, hours, and repair costs logged while the assignment is active are charged to this project's budget.

To move equipment to a different project, end the current assignment first, then create a new one.

---

## Logging hours, fuel, and breakdowns

**From the desktop:**
1. Open the equipment record and click **Log entry**.
1. Choose the entry type: **Hours**, **Fuel**, or **Breakdown / Repair request**.
1. Enter the current reading (hour-meter or odometer), quantity (for fuel: gallons or liters), or a description (for breakdowns).
1. Click **Post**.

**From the mobile app:**
1. Tap **Equipment** in the bottom navigation.
1. Find the equipment (scan its barcode or search by name).
1. Tap **+ Log** and select the entry type.
1. Fill in the form and tap **Submit**.

> **Screenshot placeholder:** Mobile app equipment detail screen with the + Log button and entry type selector.

Logged hours accumulate against the current project assignment. Fuel costs use the unit cost you enter and post to the assigned project's fuel cost code.

---

## Scheduling preventive maintenance

Each piece of equipment can have multiple maintenance schedules — for example, a 250-hour oil change and an annual inspection on the same machine.

1. Open the equipment record and click the **Maintenance** tab.
1. Click **Add schedule**.
1. Set the **Description**, **Trigger type** (Hours / Miles / Calendar), and **Interval**.
1. Set the **First due date / reading**.
1. Click **Save**.

The PM engine runs nightly and generates a work order when any schedule becomes due. To generate work orders on demand, go to **Equipment → Work Orders → Generate now**.

For a full walkthrough of work order creation, management, and completion, see [Generate and manage PM work orders](/help/equipment-work-orders).

---

## Viewing the maintenance dashboard

1. Click **Equipment → Maintenance dashboard** to see all upcoming and overdue PMs across your entire fleet.
1. The dashboard is color-coded:
   - **Green** — due in more than 30 days (or more than 20% of the interval remaining).
   - **Amber** — due within 30 days (or within 20% of the interval remaining).
   - **Red** — overdue.
1. Click any row to open the equipment record or jump to the related work order.

> **Screenshot placeholder:** Maintenance dashboard showing a fleet list with color-coded due-status badges.

---

## Tracking utilization

1. Open **Equipment → Utilization report**.
1. Set a date range and optionally filter by equipment type or project.
1. The report shows hours logged, idle time (hours owned minus hours logged), and fuel consumed per machine.
1. Export to CSV or PDF for inclusion in project cost reports.

---

## Tips

- **Rental end-date reminders** are generated automatically 7 days before the rental end date as a PM work order — check Equipment → Work Orders for the reminder if you are approaching a rental deadline.
- Breakdowns logged in the field automatically create a repair request that appears in the work orders queue. Technicians can accept, log parts, and close the repair from the same interface as scheduled PMs.
- To decommission equipment that is no longer in service, open the record and click **Deactivate**. The asset remains in the register for historical cost reporting but no longer appears in active assignment or maintenance lists.

---

Need more help? Use the **?** widget at the bottom-right of any page to open a support ticket. See [/sla](/sla) for response-time targets by plan.
