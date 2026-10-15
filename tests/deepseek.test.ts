import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { createDeepSeek, validateChoice, MODEL } = createRequire(import.meta.url)(
  '../browser/deepseek.cjs',
);
const product = {
  title: 'Perfume Yara Elixir 100ml',
  description: 'Produto original',
  category: 'perfumes',
  postalCode: 'never-send',
  profile: 'never-send',
};
const field = {
  id: 'cosmetic_type',
  label: 'Tipo',
  current: 'Produtos para pele',
  options: ['Maquiagem', 'Produtos para pele', 'Outros'],
};
function client(fetchImpl: any) {
  return createDeepSeek({
    root: '.',
    safeStorage: { encryptString: (s: string) => Buffer.from(s) },
    secureStorage: () => true,
    atomic: async () => {},
    fetchImpl,
  });
}
it('usa o modelo solicitado, JSON e apenas dados do produto; não envia credenciais no prompt', async () => {
  let request: any;
  const ai = client(async (url: string, options: any) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({
        model: 'deepseek-flash',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                option: 'Outros',
                compatible: true,
                confidence: 0.99,
                reason: 'Perfume pertence a beleza; não há opção específica.',
              }),
            },
          },
        ],
      }),
    );
  });
  await ai.configure({ key: 'sk-fake-test-key-000000000000', enabled: true });
  const choice = await ai.choose(product, field, 'Moda e beleza / Beleza e Cuidados Pessoais');
  expect(choice.option).toBe('Outros');
  expect(request.url).toBe('https://api.deepseek.com/chat/completions');
  expect(request.body.model).toBe(MODEL);
  expect(request.options.redirect).toBe('error');
  expect(request.options.body).not.toContain('never-send');
  expect(request.options.body).not.toContain('sk-fake');
  expect(ai.status()).toEqual({
    configured: true,
    enabled: true,
    model: MODEL,
    servedModel: 'deepseek-flash',
  });
  expect(JSON.stringify(ai.status())).not.toContain('key');
});
it('rejeita opções inexistentes e exige confiança alta sem inventar resposta', () => {
  expect(() =>
    validateChoice({ option: 'Perfumes', compatible: true, confidence: 1, reason: 'x' }, field),
  ).toThrow('inválida');
  expect(
    validateChoice(
      { option: 'Outros', compatible: true, confidence: 0.5, reason: 'Não há certeza' },
      field,
    ),
  ).toMatchObject({ option: null, compatible: true });
  expect(() =>
    validateChoice({ option: 'Outros', compatible: true, confidence: NaN, reason: 'x' }, field),
  ).toThrow();
});
it('não chama API quando desativada e não reproduz erro remoto com segredos', async () => {
  let calls = 0;
  const ai = client(async () => {
    calls++;
    return new Response('segredo falso remoto', { status: 401 });
  });
  await ai.configure({ key: 'sk-fake-test-key-000000000000', enabled: false });
  expect(await ai.choose(product, field, 'Beleza')).toBeNull();
  expect(calls).toBe(0);
  await ai.configure({ key: '', enabled: true });
  await expect(ai.choose(product, field, 'Beleza')).rejects.toThrow('HTTP 401');
});
it('não aceita uma resposta truncada ou JSON malformado', async () => {
  for (const data of [
    { choices: [{ finish_reason: 'length' }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'bad json' } }] },
  ]) {
    const ai = client(async () => new Response(JSON.stringify(data)));
    await ai.configure({ key: 'sk-fake-test-key-000000000000', enabled: true });
    await expect(ai.choose(product, field, 'Beleza')).rejects.toThrow();
  }
});
it('não infere condição pela aparência da foto quando faltam fatos do produto', async () => {
  let calls = 0;
  const ai = client(async () => {
    calls++;
    throw new Error('Não deveria consultar');
  });
  await ai.configure({ key: 'sk-fake-test-key-000000000000', enabled: true });
  const answer = await ai.choose(
    product,
    { id: 'condition', label: 'Condição', current: 'Selecione', options: ['Novo', 'Usado - Bom'] },
    'Beleza',
  );
  expect(answer.option).toBeNull();
  expect(answer.reason).toContain('Informações para a IA');
  expect(calls).toBe(0);
});
it('usa a condição declarada pelo usuário sem fazer chamada de IA', async () => {
  const ai = client(async () => {
    throw new Error('Não deveria consultar');
  });
  await ai.configure({ key: 'sk-fake-test-key-000000000000', enabled: true });
  const answer = await ai.choose(
    { ...product, condition: 'Novo' },
    {
      id: 'condition',
      label: 'Condição',
      current: 'Usado - Bom',
      options: ['Novo', 'Usado - Bom'],
    },
    'Beleza',
  );
  expect(answer).toMatchObject({ option: 'Novo', compatible: true, confidence: 1 });
});
