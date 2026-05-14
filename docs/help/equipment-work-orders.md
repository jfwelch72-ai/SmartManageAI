# Generate and manage PM work orders

The PM Work Order Engine reads your active preventive-maintenance schedules and automatically creates work orders when service is due — by hours, mileage, or calendar interval. Duplicate work orders for the same cycle are automatically prevented.

## Setting up a maintenance schedule

1. Open **/equipment** and select a piece of equipment.
1. Click **Maintenance → Add schedule**.
1. Choose a trigger type: **Hours** (e.g., every 250 engine hours), **Miles/km**, or **Calendar** (e.g., every 90 days).
1. Set the first due date or reading. Subsequent due dates calculate automatically after each PM is completed.

## Generating work orders

Work orders are generated automatically each night. To run on demand:

1. Go to **Equipment → Work Orders → Generate now**.
1. The system reports how many work orders were created, skipped (already open), or not yet due.

## Managing work orders

Open **Equipment → Work Orders** to see all open PMs. Each card shows the equipment, schedule description, due date or reading, and assigned technician.

Click a work order to log labor, parts used, and notes. Marking it **Completed** advances the schedule's next-due date automatically.

## Tips

- Rental returns generate a reminder 7 days before the rental end-date to avoid extension fees.
- If a schedule triggers unexpectedly, check the due-reading vs. the current hour-meter entry on the equipment record.

---

Need more help? Use the *?* widget to open a support ticket. See [/sla](/sla) for response-time targets by plan.
