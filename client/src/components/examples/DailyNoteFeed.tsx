import DailyNoteFeed from '../DailyNoteFeed';

export default function DailyNoteFeedExample() {
  const mockUsers = [
    { id: 'user-1', firstName: 'Mike', lastName: 'Johnson' },
    { id: 'user-2', firstName: 'Sarah', lastName: 'Williams' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <DailyNoteFeed 
        projectId="demo-project-id"
        availableUsers={mockUsers}
      />
    </div>
  );
}
