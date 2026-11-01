// Client limits of a node-pg pool (docs/architecture/architecture.md in the homeserver repo, "Database clients").
// These apps are used in bursts (a screen opens and sends 8 reads at once, then nothing for minutes) and node-pg opens a
// connection only when a query needs one: with the default 10 s idle timeout every burst paid 90-300 ms of pg.connect per
// connection (traces, 2026-10-31). So an idle connection is kept for ever and a few are opened at start; one is replaced
// after 6 hours, and TCP keepalive drops one that a NAT or a restart killed silently. max keeps the total small.
export function poolOptions(connectionString, { max, application_name, statement_timeout = 15_000 }) {
  return {
    connectionString,
    max,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 6 * 3600,
    statement_timeout,
    idle_in_transaction_session_timeout: 60_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
    application_name,
  }
}

// Opens n connections at once so the first screen after a start finds them ready. A failure is not an error: the pool
// opens a connection on demand. Returns how many opened.
export async function warmPool(pool, n) {
  const results = await Promise.allSettled(Array.from({ length: n }, () => pool.query('SELECT 1')))
  return results.filter((r) => r.status === 'fulfilled').length
}
