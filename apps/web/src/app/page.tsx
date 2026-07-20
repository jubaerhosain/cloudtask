export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold">CloudTask</h1>
      <p className="text-lg opacity-80">
        Multi-user task management. The application UI arrives in Milestone 6.
      </p>
      <p className="text-sm opacity-60">
        API base URL:{' '}
        <code className="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">
          {process.env.NEXT_PUBLIC_API_BASE_URL ?? '(not set)'}
        </code>
      </p>
    </main>
  );
}
