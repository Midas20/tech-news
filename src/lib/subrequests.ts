// Subrequest accounting for the Workers runtime.
//
// A Worker invocation on the free plan may make 50 subrequests; on paid, 1,000.
// EVERY outbound fetch counts -- feed fetches, article fetches, and each query
// sent over the Neon HTTP driver. The first deployment died on exactly this:
// one tick asked for 80 sources and was killed partway through.
//
// Two responses, both needed:
//   - the Worker talks to Postgres over a WebSocket pool, so a whole invocation
//     costs ONE subrequest instead of one per query
//   - collection stops cleanly while it still has budget left, rather than being
//     terminated mid-source with a half-written cycle

export interface SubrequestBudget {
  limit: number;
  used: number;
}

let active: SubrequestBudget | null = null;

/** Called once per invocation. Omit to disable accounting (local runs). */
export function startBudget(limit: number): SubrequestBudget {
  active = { limit, used: 0 };
  return active;
}

export function clearBudget(): void {
  active = null;
}

export function countSubrequest(n = 1): void {
  if (active) active.used += n;
}

export function remainingSubrequests(): number {
  return active ? Math.max(0, active.limit - active.used) : Number.POSITIVE_INFINITY;
}

/** Enough headroom left to poll one more source and still finish cleanly. */
export function canAfford(cost: number): boolean {
  return remainingSubrequests() > cost;
}

export function budgetState(): SubrequestBudget | null {
  return active ? { ...active } : null;
}
