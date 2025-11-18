import ScopeOfWorkTable from '../ScopeOfWorkTable';

export default function ScopeOfWorkTableExample() {
  const items = [
    { id: '1', description: 'Sidewalk', unit: 'SF', totalQuantity: 5000, completedQuantity: 3200 },
    { id: '2', description: 'Curb', unit: 'LF', totalQuantity: 800, completedQuantity: 650 },
    { id: '3', description: 'Slab on Grade', unit: 'SF', totalQuantity: 12000, completedQuantity: 8500 },
    { id: '4', description: 'Bollards', unit: 'EA', totalQuantity: 24, completedQuantity: 18 },
  ];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <ScopeOfWorkTable 
        items={items} 
        onUpdateProgress={(id, qty) => console.log(`Update ${id} to ${qty}`)} 
      />
    </div>
  );
}
