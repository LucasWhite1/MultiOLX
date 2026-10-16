// Dates shown by the public chat list, interpreted in the app's local timezone.
function messageTime(label, observedAt) {
  const ref = new Date(observedAt);
  if (!Number.isFinite(ref.getTime())) return null;
  const text = String(label)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let match;
  if (/^(agora|now|ha instantes|just now)$/.test(text)) return observedAt;
  if ((match = /^(\d{1,2}):(\d{2})$/.exec(text))) {
    if (+match[1] > 23 || +match[2] > 59) return null;
    day.setHours(+match[1], +match[2]);
    if (day.getTime() > observedAt) day.setDate(day.getDate() - 1);
    return day.getTime();
  }
  if (/^(hoje|today)$/.test(text)) return day.getTime();
  if (/^(ontem|yesterday)$/.test(text)) {
    day.setDate(day.getDate() - 1);
    return day.getTime();
  }
  if ((match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text))) {
    const year = match[3] ? (+match[3] < 100 ? 2000 + +match[3] : +match[3]) : ref.getFullYear();
    const date = new Date(year, +match[2] - 1, +match[1]);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== +match[2] - 1 ||
      date.getDate() !== +match[1]
    )
      return null;
    if (!match[3] && date.getTime() > observedAt) date.setFullYear(year - 1);
    return date.getTime();
  }
  if (
    (match =
      /^(?:ha\s+)?(\d+)\s*(min(?:uto)?s?|m|h|horas?|d|dias?|sem(?:ana)?s?|w|mes(?:es)?|months?|anos?|years?|y)(?:\s+ago)?$/.exec(
        text,
      ))
  ) {
    const count = +match[1],
      unit = match[2];
    const date = new Date(observedAt);
    if (/^(min|m$)/.test(unit)) return observedAt - count * 60000;
    if (/^(h)/.test(unit)) return observedAt - count * 3600000;
    if (/^(d)/.test(unit)) date.setDate(date.getDate() - count);
    else if (/^(sem|w)/.test(unit)) date.setDate(date.getDate() - count * 7);
    else if (/^(mes|month)/.test(unit)) date.setMonth(date.getMonth() - count);
    else date.setFullYear(date.getFullYear() - count);
    return date.getTime();
  }
  return null;
}
module.exports = { messageTime };
