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
    const match =
      /^Às (\d{1,2}) de ([a-zç]+) de (\d{4}) (\d{2}):(\d{2}), ([^:]+): ([\s\S]+)$/i.exec(label);
    if (!match) continue;
    const month = months.indexOf(match[2].toLowerCase());
    if (month < 0 || +match[1] > 31 || +match[4] > 23 || +match[5] > 59) continue;
    // Facebook renders this label in the browser's local timezone.
    const date = new Date(+match[3], month, +match[1], +match[4], +match[5]);
    const messageAt = date.getTime();
    if (
      date.getFullYear() !== +match[3] ||
      date.getMonth() !== month ||
      date.getDate() !== +match[1]
    )
      continue;
    if (!Number.isFinite(messageAt) || messageAt > Date.now() + 60000) continue;
    return {
      externalId: expectedId,
      preview: match[7].trim().slice(0, 10000),
      messageAt,
      messageId: row.getAttribute('data-message-id').slice(0, 300),
      timeLabel:
        date.toDateString() === new Date().toDateString()
          ? `${match[4]}:${match[5]}`
          : `${match[1]}/${month + 1}/${match[3]}`,
      lastDirection: /^(Você|You)$/i.test(match[6].trim()) ? 'outgoing' : 'incoming',
      replacePreview: true,
    };
  }
  return null;
}
module.exports = { facebookThreadDocument };
