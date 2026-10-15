function pageLimit(value) {
  const limit = Number(value);
  if (![2, 4, 6, 8].includes(limit)) throw new Error('Escolha 2, 4, 6 ou 8 páginas ativas.');
  return limit;
}
function leastRecent(ids, touched, protectedIds) {
  return ids
    .filter((id) => !protectedIds.has(id))
    .sort((a, b) => (touched.get(a) || 0) - (touched.get(b) || 0))[0];
}
module.exports = { pageLimit, leastRecent };
