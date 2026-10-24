// In-memory fake of the app DB — supports only what wactoWebhookController uses.
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });

let seq = 0;
function match(doc, q) {
  return Object.entries(q).every(([k, v]) => k === '$or' ? v.some((sub) => match(doc, sub)) : (v instanceof RegExp ? v.test(doc[k]) : doc[k] === v));
}
function col(name) {
  const rows = (H.cols[name] ||= []);
  return {
    async findOne(q) { const d = rows.find((r) => match(r, q)); return d ? structuredClone(d) : null; },
    async insertOne(d) { const row = structuredClone(d); row._id ??= `id${++seq}`; rows.push(row); return { acknowledged: true, insertedId: row._id }; },
    async updateOne(q, u, opts = {}) {
      let d = rows.find((r) => match(r, q));
      if (!d) { if (!opts.upsert) return { matchedCount: 0 }; d = { ...q }; rows.push(d); }
      Object.assign(d, structuredClone(u.$set || {}));
      return { matchedCount: 1 };
    },
    find(q = {}) {
      const hits = () => rows.filter((r) => match(r, q)).map((r) => structuredClone(r));
      const cur = { sort() { return cur; }, skip() { return cur; }, limit() { return cur; }, async toArray() { return hits(); } };
      return cur;
    },
    async countDocuments(q = {}) { return rows.filter((r) => match(r, q)).length; },
    async deleteOne(q) { const i = rows.findIndex((r) => match(r, q)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
  };
}
export function getAppDb() { return { collection: col }; }
