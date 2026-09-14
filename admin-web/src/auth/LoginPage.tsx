import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PageContainer, Button, FormField, Input, Alert } from '../ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Invalid email or password');
    }
  }

  return (
    <PageContainer>
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-sm flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa - Admin</h1>
        <FormField label="Email">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </FormField>
        <FormField label="Password">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        </FormField>
        {error && <Alert>{error}</Alert>}
        <Button type="submit">Log in</Button>
      </form>
    </PageContainer>
  );
}
