import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { fillAttributes } = createRequire(import.meta.url)('../browser/listing-attributes.cjs');
function fixture() {
  const values: any = { type: 'Produtos para pele', brand: 'Selecione' };
  const selected: string[] = [];
  const io = {
    assertActive: () => {},
    pause: async () => {},
    dom: async (c: any) => {
      if (c.action === 'list')
        return [
          { id: 'type', label: 'Tipo', current: values.type },
          { id: 'brand', label: 'Marca', current: values.brand },
        ];
      if (c.action === 'options')
        return c.id === 'type'
          ? ['Produtos para pele', 'Outros']
          : values.type === 'Outros'
            ? ['Lattafa', 'Outras marcas']
            : ['Marca para pele'];
      if (c.action === 'select') {
        values[c.id] = c.option;
        selected.push(c.option);
      }
      if (c.action === 'value') return values[c.id];
      return true;
    },
    choose: async (_: any, f: any) => ({
      option: f.id === 'type' ? 'Outros' : 'Lattafa',
      compatible: true,
    }),
  };
  return { io, selected };
}
it('recolhe opções após cada escolha, respeitando a dependência entre tipo e marca', async () => {
  const f = fixture();
  const result = await fillAttributes({}, f.io);
  expect(f.selected).toEqual(['Outros', 'Lattafa']);
  expect(result).toMatchObject({ compatible: true, pending: [] });
});
it('interrompe se a conta mudar durante a consulta à IA', async () => {
  const f = fixture();
  let active = true;
  f.io.assertActive = () => {
    if (!active) throw new Error('Conta mudou');
  };
  f.io.choose = async () => {
    active = false;
    return { option: 'Outros', compatible: true };
  };
  await expect(fillAttributes({}, f.io)).rejects.toThrow('Conta mudou');
  expect(f.selected).toEqual([]);
});
it('não injeta opções arbitrárias retornadas por uma IA', async () => {
  const f = fixture();
  f.io.choose = async () => ({ option: 'Opção inventada', compatible: true });
  await expect(fillAttributes({}, f.io)).rejects.toThrow('inexistente');
  expect(f.selected).toEqual([]);
});
