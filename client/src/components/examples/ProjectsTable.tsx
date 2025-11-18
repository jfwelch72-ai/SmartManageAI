import ProjectsTable from '../ProjectsTable';

export default function ProjectsTableExample() {
  const projects = [
    {
      id: '1',
      code: 'TFR-240639',
      name: 'OSU Outpatient East – Parking Lot',
      clientName: 'Ohio State University',
      status: 'ACTIVE' as const,
      superintendent: 'Mike Johnson',
      estimator: 'Sarah Williams',
    },
    {
      id: '2',
      code: 'TFR-240512',
      name: 'Downtown Office Tower Foundation',
      clientName: 'Cityscape Developers',
      status: 'PLANNING' as const,
      superintendent: 'Tom Anderson',
      estimator: 'Sarah Williams',
    },
    {
      id: '3',
      code: 'TFR-240420',
      name: 'Riverside Apartment Complex',
      clientName: 'Riverside Properties LLC',
      status: 'BID' as const,
      estimator: 'David Chen',
    },
  ];

  return <ProjectsTable projects={projects} onRowClick={(p) => console.log('Clicked:', p.name)} />;
}
