import ProjectCard from '../ProjectCard';

export default function ProjectCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <ProjectCard
        code="TFR-240639"
        name="OSU Outpatient East – Parking Lot"
        clientName="Ohio State University"
        status="ACTIVE"
        location="Columbus, OH"
        superintendent="Mike Johnson"
        onClick={() => console.log('Project clicked')}
      />
      <ProjectCard
        code="TFR-240512"
        name="Downtown Office Tower Foundation"
        clientName="Cityscape Developers"
        status="PLANNING"
        location="Columbus, OH"
        superintendent="Sarah Williams"
        onClick={() => console.log('Project clicked')}
      />
      <ProjectCard
        code="TFR-240420"
        name="Riverside Apartment Complex"
        clientName="Riverside Properties LLC"
        status="BID"
        location="Dublin, OH"
        onClick={() => console.log('Project clicked')}
      />
    </div>
  );
}
