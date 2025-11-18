import LoginForm from '../LoginForm';

export default function LoginFormExample() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm onLogin={(email, password) => console.log('Login:', email, password)} />
    </div>
  );
}
