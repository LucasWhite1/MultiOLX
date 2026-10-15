// Bounded wizard runner. All interaction is supplied by the account's visible WebContents.
async function prepareListingSteps(p, io) {
  const completed = new Set();
  const photoRetries = new Map();
  const categories = new Set();
  const onboardingAttempts = new Map();
  let state,
    reason = '',
    waitingSince = io.now();
  const signature = (s) =>
    JSON.stringify({
      status: s.status,
      fields:
        s.fields &&
        Object.fromEntries(
          Object.entries(s.fields).map(([k, v]) => [
            k,
            v && { id: v.id, name: v.name, tag: v.tag },
          ]),
        ),
      stage: s.stage,
    });
  const normalize = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  for (let attempt = 0; attempt < 160; attempt++) {
    io.assertActive();
    state = await io.inspect();
    if (state.status === 'SUBMITTED') return { state, submitted: true };
    if (state.status === 'CATEGORY') {
      const key = JSON.stringify(state.categoryOptions);
      if (!io.category || categories.size >= 5) {
        reason = 'Escolha a categoria na OLX e use Preencher / continuar.';
        break;
      }
      if (categories.has(key)) {
        if (io.now() - waitingSince > 5000) {
          reason = 'A OLX não abriu a categoria escolhida. Confira a página.';
          break;
        }
        await io.pause(250);
        continue;
      }
      try {
        if (!(await io.category(state))) {
          reason = 'A IA não identificou uma categoria com segurança. Escolha na OLX e continue.';
          break;
        }
        io.assertActive();
      } catch (error) {
        reason = 'Seleção de categoria interrompida: ' + error.message;
        break;
      }
      categories.add(key);
      waitingSince = io.now();
      await io.pause(500);
      continue;
    }
    if (state.stage === 'attributes' && io.attributes && !p.aiAttempted) {
      let assisted;
      try {
        assisted = await io.attributes(state);
        io.assertActive();
      } catch (error) {
        reason = 'Preenchimento por IA interrompido: ' + error.message;
        break;
      }
      p.aiAttempted = true;
      p.aiCompatible = assisted.compatible === true;
      p.aiChanges = assisted.changes;
      p.aiReview = assisted.decisions;
      if (!p.aiCompatible) {
        reason =
          'A IA não confirmou esta categoria para o produto. ' +
          (assisted.decisions
            ?.filter((d) => !d.compatible)
            .map((d) => d.reason)
            .filter(Boolean)
            .join(' · ') || 'Confira a categoria na OLX.');
        break;
      }
      if (assisted.pending.length) {
        reason =
          'Confira as características não identificadas pela IA: ' +
          assisted.pending.join(', ') +
          '. Depois use Preencher / continuar.';
        break;
      }
      state = await io.inspect();
    }
    if (
      (state.errors?.length ||
        (state.stage === 'attributes' && /Campo obrigat[óo]rio/i.test(state.categoryText || ''))) &&
      (state.stage === 'attributes' || completed.has(signature(state)))
    ) {
      reason =
        state.stage === 'attributes'
          ? 'Complete marca, modelo e condição exigidos pela OLX; depois use Preencher / continuar.'
          : 'A OLX informou: ' + state.errors.join(' · ');
      break;
    }
    // The native photo step can enable Continue before its upload state settles.
    // Retry only that intermediate control, without attaching the files again.
    const key = signature(state);
    if (
      completed.has(key) &&
      state.stage === 'photos' &&
      !state.photoBusy &&
      state.canContinue &&
      !state.errors?.length &&
      io.now() - waitingSince >= 2500 &&
      (photoRetries.get(key) || 0) < 3
    ) {
      io.assertActive();
      await io.advance();
      photoRetries.set(key, (photoRetries.get(key) || 0) + 1);
      waitingSince = io.now();
      await io.pause(350);
      continue;
    }
    if (['WAIT', 'UNKNOWN'].includes(state.status) || completed.has(signature(state))) {
      if (io.now() - waitingSince > 25000) {
        reason = 'A OLX não concluiu a etapa. Confira a página e use Preencher / continuar.';
        break;
      }
      await io.pause(250);
      continue;
    }
    if (state.status === 'ONBOARDING') {
      if (io.onboarding) {
        const step = await io.onboarding();
        if (step.progress) {
          const repeats = (onboardingAttempts.get(step.stage) || 0) + 1;
          onboardingAttempts.set(step.stage, repeats);
          if (repeats > 4) {
            reason = 'A OLX não avançou na etapa de entrega. Confira esta conta.';
            break;
          }
          waitingSince = io.now();
          await io.pause(600);
          continue;
        }
        if (io.now() - waitingSince < 10000 && step.stage !== 'IDENTITY') {
          await io.pause(300);
          continue;
        }
        reason = step.reason || 'A OLX não concluiu a escolha de entrega. Confira esta conta.';
        break;
      }
      reason =
        'Conclua os dados e as opções exigidas pela OLX nesta conta; depois use Preencher / continuar.';
      break;
    }
    if (['LOGIN', 'BLOCKED', 'WRONG_PAGE'].includes(state.status)) {
      reason =
        state.status === 'LOGIN'
          ? 'Entre na OLX nesta conta.'
          : 'A OLX exige uma verificação ou a página mudou. Confira a página aberta.';
      break;
    }
    if (state.status === 'OFFERS') {
      await io.selectFree();
      state = await io.inspect();
      if (io.autoSubmit && state.freeSelected && state.canSubmit) {
        if (
          !p.photosAttached ||
          !['title', 'description', 'price', ...(p.listing.postalCode ? ['postalCode'] : [])].every(
            (k) => p.filled.includes(k),
          )
        ) {
          reason = 'Os dados e fotos deste anúncio ainda não foram confirmados.';
          break;
        }
        return io.submit();
      }
      reason = 'Publicação gratuita selecionada. Revise o anúncio e clique em Enviar anúncio.';
      break;
    }
    if (state.status !== 'FORM') {
      reason = 'Confira a etapa aberta na OLX.';
      break;
    }
    if (state.stage === 'attributes') {
      // Never infer condition, battery, brand or other factual details from a title.
      if (
        state.requiredAttributes ||
        (!p.aiCompatible &&
          p.listing.category &&
          !normalize(state.categoryText).includes(normalize(p.listing.category)))
      ) {
        reason =
          'Confira a categoria e complete as características na OLX; depois use Preencher / continuar.';
        break;
      }
      if (!state.canContinue || state.errors?.length) {
        reason = 'Complete as características exigidas pela OLX.';
        break;
      }
    } else {
      const result = await io.fill(p.listing);
      p.filled = [...new Set([...p.filled, ...result.filled])];
      if (state.photoInput && !p.photosAttached) {
        const upload = await io.photos();
        p.photosAttached = upload.attached === true;
        if (!p.photosAttached) {
          reason = 'Não foi possível adicionar as fotos. Confira a etapa da OLX.';
          break;
        }
        // Allow React to begin upload before consulting progress or the enabled next control.
        await io.pause(1000);
      }
      const until = io.now() + 25000;
      do {
        io.assertActive();
        state = await io.inspect();
        if (
          ((!state.photoInput || !state.photoBusy) && (state.canContinue || state.canSubmit)) ||
          state.errors?.length
        )
          break;
        await io.pause(250);
      } while (io.now() < until);
      if (state.errors?.length) {
        reason = 'A OLX informou: ' + state.errors.join(' · ');
        break;
      }
      if (state.photoInput && (state.photoBusy || !p.photosAttached)) {
        reason = 'Aguarde o processamento das fotos na OLX e continue.';
        break;
      }
      if (state.canSubmit) {
        if (io.autoSubmit) return io.submit();
        reason = 'Dados aplicados. Revise o anúncio antes de enviar.';
        break;
      }
      if (!state.canContinue || (!result.filled.length && !state.photoInput)) {
        reason = 'Complete a etapa aberta na OLX e continue.';
        break;
      }
    }
    completed.add(signature(state));
    io.assertActive();
    if (!(await io.advance())) {
      reason = 'A OLX não permitiu avançar. Confira os campos da etapa.';
      break;
    }
    waitingSince = io.now();
    await io.pause(350);
  }
  const allFilled = [
    'title',
    'description',
    'price',
    ...(p.listing.postalCode ? ['postalCode'] : []),
  ].every((k) => p.filled.includes(k));
  return {
    state,
    reason,
    canSubmit:
      !!state?.canSubmit &&
      p.photosAttached &&
      allFilled &&
      (state.status !== 'OFFERS' || state.freeSelected),
  };
}
module.exports = { prepareListingSteps };
