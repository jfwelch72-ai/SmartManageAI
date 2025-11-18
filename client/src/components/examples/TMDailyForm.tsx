import TMDailyForm from '../TMDailyForm';

export default function TMDailyFormExample() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <TMDailyForm 
        projectName="OSU Outpatient East – Parking Lot" 
        onSubmit={(data) => console.log('T&M Daily submitted:', data)} 
      />
    </div>
  );
}
