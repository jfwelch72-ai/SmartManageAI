import TimeEntryForm from '../TimeEntryForm';

export default function TimeEntryFormExample() {
  const projects = [
    { id: '1', code: 'TFR-240639', name: 'OSU Outpatient East' },
    { id: '2', code: 'TFR-240512', name: 'Downtown Office Tower' },
    { id: '3', code: 'TFR-240420', name: 'Riverside Apartments' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <TimeEntryForm 
        projects={projects} 
        onSubmit={(entry) => console.log('Time entry submitted:', entry)} 
      />
    </div>
  );
}
