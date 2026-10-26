function adMetrics(text = '', now = Date.now(), datetime = '') {
  const day = 86400000;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type) => Number(parts.find((p) => p.type === type).value);
  const today = Date.UTC(value('year'), value('month') - 1, value('day'));
  function calendar(y, m, d, allowFuture = false) {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d &&
      (allowFuture || date.getTime() <= today)
      ? date.getTime()
      : null;
  }
  const dates = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)]
    .map((m) => calendar(Number(m[3]) + (m[3].length === 2 ? 2000 : 0), Number(m[2]), Number(m[1])))
    .filter((n) => n !== null);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(datetime);
  let published = iso
    ? calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : new Set(dates).size === 1
      ? dates[0]
      : null;
  if (
    iso &&
    calendar(Number(iso[1]), Number(iso[2]), Number(iso[3]), true) != null &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(datetime) &&
    Number.isFinite(Date.parse(datetime))
  ) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(Date.parse(datetime));
    const part = (type) => Number(local.find((p) => p.type === type).value);
    published = calendar(part('year'), part('month'), part('day'));
  }
  const integer = '(\\d{1,3}(?:\\.\\d{3})+|\\d+)';
  function counter(label) {
    const values = [
      ...text.matchAll(new RegExp('(?<![\\d.,/])' + integer + '\\s+' + label + '\\b', 'gi')),
      ...text.matchAll(new RegExp('\\b' + label + '\\s*:?\\s*' + integer + '(?![\\d.,/])', 'gi')),
    ].map((m) => Number(m[1].replaceAll('.', '')));
    return values.length && new Set(values).size === 1 && Number.isSafeInteger(values[0])
      ? values[0]
      : null;
  }
  const received = counter('mensage(?:m|ns) recebida(?:s)?');
  return {
    publishedDate: published == null ? null : new Date(published).toISOString().slice(0, 10),
    daysPublished: published == null ? null : Math.floor((today - published) / day),
    views: counter('(?:visitas?|visualizaç(?:ão|ões))'),
    messages: received ?? counter('mensage(?:m|ns)'),
    messagesScope: received == null ? 'unspecified' : 'received',
    conversations: counter('conversas?'),
    observedAt: new Date(now).toISOString(),
  };
}
function cachedConversations(item, siblings, inbox) {
  const normalize = (s) =>
    (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  if (siblings.filter((r) => normalize(r.title) === normalize(item.title)).length !== 1)
    return null;
  const account = inbox?.accounts?.find((r) => r.id === item.owner);
  if (!account?.observedAt) return null;
  return {
    count: new Set(
      (inbox.conversations || [])
        .filter(
          (r) => r.profileId === item.owner && normalize(r.listingTitle) === normalize(item.title),
        )
        .map((r) => r.key || r.externalId),
    ).size,
    observedAt: account.observedAt,
  };
}
module.exports = { adMetrics, cachedConversations };
