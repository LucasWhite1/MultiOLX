import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { runPool } = createRequire(import.meta.url)('../browser/publish-pool.cjs');
it('executa duas contas simultaneamente sem exceder o limite, isolando falhas por conta', async () => {
  let active = 0,
    peak = 0;
  const results: string[] = [];
  await runPool(['A', 'B', 'C'], 2, async (owner: string) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((r) => setTimeout(r, 10));
      if (owner === 'B') throw new Error('Conta desconectada');
      results.push(owner);
    } catch {
      results.push('B falhou');
    } finally {
      active--;
    }
  });
  expect(peak).toBe(2);
  expect(results.sort()).toEqual(['A', 'B falhou', 'C']);
});
it('cancela as contas pendentes e permite encerrar as que já iniciaram', async () => {
  let cancelled = false;
  const started: number[] = [];
  await runPool(
    [1, 2, 3, 4],
    2,
    async (n: number) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 5));
      cancelled = true;
    },
    () => cancelled,
  );
  expect(started).toEqual([1, 2]);
});
