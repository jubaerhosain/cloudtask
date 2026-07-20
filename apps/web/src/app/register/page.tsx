'use client';

import { registerRequestSchema, type RegisterRequest } from '@cloudtask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, Button, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api-client';
import { setSession } from '../../lib/auth-store';

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterRequest>({ resolver: zodResolver(registerRequestSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.register(values);
      const session = await api.login({ email: values.email, password: values.password });
      setSession(session.accessToken, session.user);
      router.replace('/projects');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Registration failed');
    }
  });

  return (
    <div className="mx-auto max-w-sm space-y-4 py-8">
      <h1 className="text-2xl font-bold">Create account</h1>
      {formError ? <Alert>{formError}</Alert> : null}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Display name" error={errors.displayName?.message}>
          <Input {...register('displayName')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="text-sm">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
