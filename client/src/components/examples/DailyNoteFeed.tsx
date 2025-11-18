import DailyNoteFeed from '../DailyNoteFeed';

export default function DailyNoteFeedExample() {
  const notes = [
    {
      id: '1',
      author: 'Mike Johnson',
      authorRole: 'Superintendent',
      date: '2024-01-18',
      time: '4:30 PM',
      content: 'Completed 1,200 SF of sidewalk today. Weather was clear. Concrete delivery arrived on time. No safety incidents.',
    },
    {
      id: '2',
      author: 'Sarah Williams',
      authorRole: 'Project Manager',
      date: '2024-01-17',
      time: '3:15 PM',
      content: 'Met with client rep regarding schedule adjustment for upcoming rain forecast. Agreed to shift curb work to next week.',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <DailyNoteFeed 
        notes={notes} 
        onAddNote={(content) => console.log('New note:', content)} 
      />
    </div>
  );
}
