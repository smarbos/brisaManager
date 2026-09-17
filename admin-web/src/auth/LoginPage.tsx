import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { PageContainer, Button, Card, FormField, Input, Alert } from '../ui';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('Email o contraseña incorrectos');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <Card className="mx-auto max-w-sm">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h1 className="font-heading text-2xl font-semibold text-heading">La Brisa - Admin</h1>
          <FormField label="Correo electrónico">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </FormField>
          <FormField label="Contraseña">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
          </FormField>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={submitting}>
            Iniciar sesión
          </Button>
        </form>
      </Card>
    </PageContainer>
  );
}
