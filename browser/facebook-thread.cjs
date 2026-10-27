// Read only the current, previously verified Marketplace thread's public messages.
function facebookThreadDocument(expectedId) {
  if (
    location.origin !== 'https://www.facebook.com' ||
    /^\/messages\/t\/(\d+)\/?$/.exec(location.pathname)?.[1] !== expectedId
  )
    return null;
  const visible = (n) =>
    n.getClientRects().length &&
    !n.closest('[aria-hidden=true]') &&
    getComputedStyle(n).visibility !== 'hidden';
  const mains = [...document.querySelectorAll('main,[role=main]')].filter(
    (n) =>
      visible(n) &&
      [...n.querySelectorAll('[contenteditable=true][role=textbox],textarea')].filter(visible)
        .length === 1,
  );
  const scope = mains.filter((n) => !mains.some((other) => other !== n && n.contains(other)));
  if (scope.length !== 1) return null;
  const months = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const rows = [...scope[0].querySelectorAll('[data-message-id][aria-label]')].filter(visible);
  for (const row of rows.reverse()) {
    const label = row.getAttribute('aria-label');
    const absolute =
      /^Às (\d{1,2}) de ([a-zç]+) de (\d{4}) (\d{2}):(\d{2}), ([^:]+): ([\s\S]+)$/i.exec(label);
    const relative =
      !absolute &&
      /^Às (?:(Hoje|Ontem|Domingo|Segunda(?:-feira)?|Terça(?:-feira)?|Quarta(?:-feira)?|Quinta(?:-feira)?|Sexta(?:-feira)?|Sábado)\s+)?(\d{1,2}):(\d{2}), ([^:]+): ([\s\S]+)$/i.exec(
        label,
      );
    if (!absolute && !relative) continue;
    // Facebook renders both full dates and relative dates in the browser's local timezone.
    let date, author, preview;
    if (absolute) {
      const month = months.indexOf(absolute[2].toLowerCase());
      if (month < 0 || +absolute[1] > 31 || +absolute[4] > 23 || +absolute[5] > 59) continue;
      date = new Date(+absolute[3], month, +absolute[1], +absolute[4], +absolute[5]);
      if (
        date.getFullYear() !== +absolute[3] ||
        date.getMonth() !== month ||
        date.getDate() !== +absolute[1]
      )
        continue;
      author = absolute[6];
      preview = absolute[7];
    } else {
      if (+relative[2] > 23 || +relative[3] > 59) continue;
      date = new Date();
      const day = (relative[1] || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/-feira$/, '');
      if (day === 'ontem') date.setDate(date.getDate() - 1);
      else if (day && day !== 'hoje') {
        const weekday = [
          'domingo',
          'segunda',
          'terca',
          'quarta',
          'quinta',
          'sexta',
          'sabado',
        ].indexOf(day);
        date.setDate(date.getDate() - ((date.getDay() - weekday + 7) % 7 || 7));
      }
      date.setHours(+relative[2], +relative[3], 0, 0);
      if (!day && date.getTime() > Date.now() + 60000) date.setDate(date.getDate() - 1);
      author = relative[4];
      preview = relative[5];
    }
    const messageAt = date.getTime();
    if (!Number.isFinite(messageAt) || messageAt > Date.now() + 60000) continue;
    return {
      externalId: expectedId,
      preview: preview.trim().slice(0, 10000),
      messageAt,
      messageId: row.getAttribute('data-message-id').slice(0, 300),
      timeLabel:
        date.toDateString() === new Date().toDateString()
          ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
          : `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`,
      lastDirection: /^(Você|You)$/i.test(author.trim()) ? 'outgoing' : 'incoming',
      replacePreview: true,
    };
  }
  return null;
}
module.exports = { facebookThreadDocument };
