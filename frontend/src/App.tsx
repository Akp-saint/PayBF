import { useEffect, useState } from 'react';

type Health = { status: 'ok' | 'degraded'; environment: string; checks: { database: string; redis: string } };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
        SANDBOX · aucun fonds réel
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">PayBF</h1>
      <p className="text-slate-400">Une seule API pour accepter les paiements en Afrique francophone.</p>
      <section className="rounded-xl border border-ink-700 bg-ink-800 p-4 text-sm">
        <h2 className="mb-2 font-medium text-slate-200">État de l'API</h2>
        {error && <p className="text-rose-400">API injoignable</p>}
        {!error && !health && <p className="text-slate-400">Vérification…</p>}
        {health && (
          <ul className="space-y-1 text-slate-300">
            <li>Statut : <span className={health.status === 'ok' ? 'text-brand-400' : 'text-amber-300'}>{health.status}</span></li>
            <li>Base de données : {health.checks.database}</li>
            <li>Redis : {health.checks.redis}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
