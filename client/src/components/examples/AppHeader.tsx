import AppHeader from '../AppHeader';

export default function AppHeaderExample() {
  return (
    <AppHeader 
      userName="John Smith" 
      userRole="Project Manager" 
      onLogout={async () => console.log('Logout clicked')} 
    />
  );
}
