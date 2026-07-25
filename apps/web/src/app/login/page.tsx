'use client';

import { loginRequestSchema, type LoginRequest } from '@cloudtask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { setSession } from '../../lib/auth-store';

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await api.login(values);
      setSession(session.accessToken, session.user);
      router.replace('/projects');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Login failed');
    }
  });

  return (
    <div className="mx-auto max-w-sm space-y-4 py-8">
      <h1 className="text-2xl font-bold">Log in</h1>
      {formError ? <Alert>{formError}</Alert> : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Signing in…' : 'Log in'}
        </Button>
      </form>
      <p className="text-sm">
        Need an account?{' '}
        <Link href="/register" className="underline">
          Register
        </Link>
      </p>
    </div>
  );
}
