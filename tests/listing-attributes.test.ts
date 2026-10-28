import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { fillAttributes, fillKnownCondition } = createRequire(import.meta.url)(
  '../browser/listing-attributes.cjs',
);
it('preenche a condição explícita sem consultar IA e preserva o tipo já preenchido pela OLX', async () => {
  let condition = 'Selecione';
  const selected: string[] = [];
  const result = await fillKnownCondition(
    { condition: 'Novo' },
    {
      assertActive() {},
      pause: async () => {},
      dom: async (command: any) => {
        if (command.action === 'list')
          return [
            { id: 'tools_type', label: 'Tipo', current: 'Furadeiras e Parafusadeiras' },
            { id: 'tools_condition', label: 'Condição', current: condition },
          ];
        expect(command.id).toBe('tools_condition');
        if (command.action === 'options') return ['Novo', 'Usado - Excelente'];
        if (command.action === 'select') {
          condition = command.option;
          selected.push(command.option);
        }
        if (command.action === 'value') return condition;
      },
    },
  );
  expect(selected).toEqual(['Novo']);
  expect(result.pending).toEqual([]);
});
it('não inventa uma condição equivalente se a opção exata estiver indisponível', async () => {
  const result = await fillKnownCondition(
    { condition: 'Novo' },
    {
      assertActive() {},
      pause: async () => {},
      dom: async (command: any) =>
        command.action === 'list'
          ? [{ id: 'condition', label: 'Condição', current: 'Selecione' }]
          : command.action === 'options'
            ? ['Usado - Bom']
            : 'Selecione',
    },
  );
  expect(result.pending).toEqual(['Condição']);
});
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
