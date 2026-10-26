import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const { createAdManagement, groupTitle } = createRequire(import.meta.url)(
  '../browser/ad-management.cjs',
);
function fixture() {
  const calls: any[] = [],
    journal: any[] = [];
  let items = [
    {
      id: '123456789',
      title: 'Caixa de som',
      price: 'R$ 100,00',
      url: 'https://www.olx.com.br/vi/123456789',
    },
  ];
  let noConfirmation = false,
    changed = false,
    journalFails = false;
  const contents = {
    isDestroyed: () => false,
    setBackgroundThrottling: () => {},
    executeJavaScript: async (source: string) => {
      const command = JSON.parse(source.slice(source.lastIndexOf(')(') + 2, -1));
      calls.push(command);
      if (command.action === 'scan') return { ready: true, items, next: false };
      if (command.action === 'open-delete')
        return changed ? { error: 'O anúncio mudou' } : { clicked: true };
      if (command.action === 'confirm-delete') {
        if (!noConfirmation) items = [];
        return { submitted: true };
      }
      if (command.action === 'verify-delete') return { deleted: !noConfirmation };
      throw Error('Unexpected command');
    },
  };
  const workers = new Map();
  const manager = createAdManagement({
    profiles: () => [
      { id: 'a', name: 'Conta A' },
      { id: 'b', name: 'Conta B' },
    ],
    workers,
    blocked: () => false,
    open: async () => contents,
    pause: async () => {},
    journal: async (r: any) => {
      if (journalFails) throw Error('Cofre indisponível');
      journal.push(structuredClone(r));
    },
  });
  return {
    manager,
    calls,
    journal,
    workers,
    changed: () => (changed = true),
    noConfirmation: () => (noConfirmation = true),
    failJournal: () => (journalFails = true),
  };
}
it('agrupa espaços e caixa sem confundir títulos diferentes', () => {
  expect(groupTitle('  CAIXA   de Som ')).toBe(groupTitle('Caixa de som'));
  expect(groupTitle('iPhone 13')).not.toBe(groupTitle('iPhone 14'));
});
it('consulta contas separadas, não exclui ao selecionar/revisar e remove só a seleção', async () => {
  const f = fixture();
  f.manager.scan(['a', 'b']);
  await f.manager.wait();
  const all = f.manager.snapshot().items;
  expect(all).toHaveLength(2);
  const review = f.manager.prepare([all[1].key]);
  expect(f.calls.some((c) => c.action === 'open-delete')).toBe(false);
  f.manager.remove(review.token);
  await f.manager.wait();
  expect(f.manager.snapshot().results.map((r: any) => [r.owner, r.status])).toEqual([
    ['b', 'DELETED'],
  ]);
  expect(f.manager.snapshot().items.map((r: any) => r.owner)).toEqual(['a']);
  const count = f.calls.length;
  f.manager.remove(review.token);
  await f.manager.wait();
  expect(f.calls).toHaveLength(count);
  expect(f.journal.some((r) => r.status === 'UNCERTAIN')).toBe(true);
  expect(f.workers.size).toBe(0);
});
it('recusa seleção forjada, duplicada e token inválido', async () => {
  const f = fixture();
  expect(() => f.manager.scan(['intruso'])).toThrow('válidas');
  f.manager.scan(['a']);
  await f.manager.wait();
  const key = f.manager.snapshot().items[0].key;
  expect(() => f.manager.prepare([key, key])).toThrow();
  expect(() => f.manager.prepare(['outro:id'])).toThrow('Atualize');
  expect(() => f.manager.remove('forjado')).toThrow('inválida');
  expect(() => f.manager.remove(crypto.randomUUID())).toThrow('expirou');
});
it('revalida o anúncio e não envia confirmação se ele mudou', async () => {
  const f = fixture();
  f.manager.scan(['a']);
  await f.manager.wait();
  const review = f.manager.prepare([f.manager.snapshot().items[0].key]);
  f.changed();
  f.manager.remove(review.token);
  await f.manager.wait();
  expect(f.calls.some((c) => c.action === 'confirm-delete')).toBe(false);
  expect(f.manager.snapshot().results[0].status).toBe('ERROR');
});
it('não anuncia sucesso nem tenta confirmar duas vezes após resultado incerto', async () => {
  const f = fixture();
  f.manager.scan(['a']);
  await f.manager.wait();
  const review = f.manager.prepare([f.manager.snapshot().items[0].key]);
  f.noConfirmation();
  f.manager.remove(review.token);
  await f.manager.wait();
  expect(f.manager.snapshot().results[0].status).toBe('UNCERTAIN');
  expect(f.calls.filter((c) => c.action === 'confirm-delete')).toHaveLength(1);
});
it('bloqueia novas operações enquanto consulta e permite cancelar pendentes', async () => {
  const f = fixture();
  f.manager.scan(['a', 'b']);
  expect(() => f.manager.scan(['a'])).toThrow('Aguarde');
  f.manager.cancel();
  await f.manager.wait();
  expect(f.manager.snapshot().accounts.every((a: any) => a.status === 'CANCELLED')).toBe(true);
  expect(f.calls).toHaveLength(0);
});
it('não confirma exclusão se não conseguir gravar o registro no cofre', async () => {
  const f = fixture();
  f.manager.scan(['a']);
  await f.manager.wait();
  const review = f.manager.prepare([f.manager.snapshot().items[0].key]);
  f.failJournal();
  f.manager.remove(review.token);
  await f.manager.wait();
  expect(f.calls.some((c) => c.action === 'confirm-delete')).toBe(false);
  expect(f.manager.snapshot().error).toContain('Cofre');
});
