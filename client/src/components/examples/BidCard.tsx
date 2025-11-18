import BidCard from '../BidCard';

export default function BidCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <BidCard
        code="BID-240815"
        name="City Hall Renovation - Phase 2"
        clientName="City of Columbus"
        bidAmount="$625,000"
        dueDate="2024-02-15"
        location="Columbus, OH"
        estimator="Sarah Williams"
        onClick={() => console.log('Bid clicked')}
        onConvertToProject={() => console.log('Convert to project')}
      />
      <BidCard
        code="BID-240722"
        name="Shopping Plaza Foundation"
        clientName="Retail Development Corp"
        bidAmount="$380,000"
        dueDate="2024-02-20"
        location="Dublin, OH"
        estimator="David Chen"
        onClick={() => console.log('Bid clicked')}
      />
    </div>
  );
}
