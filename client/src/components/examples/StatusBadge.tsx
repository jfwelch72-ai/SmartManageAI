import StatusBadge from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="BID" type="project" />
      <StatusBadge status="PLANNING" type="project" />
      <StatusBadge status="ACTIVE" type="project" />
      <StatusBadge status="COMPLETE" type="project" />
      <StatusBadge status="CLOSED" type="project" />
      <StatusBadge status="DRAFT" type="estimate" />
      <StatusBadge status="SUBMITTED" type="estimate" />
      <StatusBadge status="WON" type="estimate" />
      <StatusBadge status="LOST" type="estimate" />
    </div>
  );
}
