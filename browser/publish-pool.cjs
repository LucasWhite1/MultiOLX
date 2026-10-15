async function runPool(items, limit, work, cancelled = () => false) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, Math.max(1, limit)) }, async () => {
      while (!cancelled()) {
        const index = next++;
        if (index >= items.length) return;
        await work(items[index], index);
      }
    }),
  );
}
module.exports = { runPool };
