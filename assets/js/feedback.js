/* feedback.js — talks to the listening-review feedback service (base URL from data/config.json "feedback_api").
 *
 * Feedback.init()            loads data/config.json; resolves true when feedback is open (a base URL exists).
 * Feedback.enabled           true once init found a base URL.
 * Feedback.reviewer()        {name, role} remembered on this device (localStorage, every access in try/catch; works without it).
 * Feedback.setReviewer(o)    remember {name, role}.
 * Feedback.send(payload)     POST /feedback → {state:"sent"|"queued"|"error"|"too_many", id?, message?}. A network failure or
 *                            a 5xx keeps the submission on this device and retries it (on "online", every 30 s, next visit).
 *                            429 → "too_many"; any other 4xx → "error" with the service's plain sentence. Neither is queued.
 * Feedback.pending()         number of submissions waiting to send.  Feedback.flush() retries them now.
 * Feedback.onChange(fn)      called after any queue change / flush / send.
 * Feedback.list(recId)       GET /feedback?rec_id= → newest-first array, or null when the service cannot be reached.
 * Feedback.counts(ids)       {rec_id: n}: one GET per id, at most 4 in flight.
 * Feedback.api()             the service's base URL (or null), for the speaking review's extra endpoints.
 */
(function () {
  const QKEY = "rz.review.queue", RKEY = "rz.review.reviewer";
  let API = null, memQueue = [], memReviewer = { name: "", role: "" }, flushing = false, timer = null;
  const listeners = [];

  const store = {
    get(k, d) { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const readQueue = () => { const q = store.get(QKEY, null); return Array.isArray(q) ? q : memQueue; };
  const writeQueue = (q) => { memQueue = q; store.set(QKEY, q); };
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) {} });

  async function post(payload) {
    let r;
    try {
      r = await fetch(API + "/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (e) { return { retry: true }; }
    if (r.status === 201 || r.status === 200) {
      let j = {}; try { j = await r.json(); } catch (e) {}
      return { ok: true, id: j.id };
    }
    if (r.status >= 500) return { retry: true, status: r.status };
    let msg = ""; try { const j = await r.json(); msg = j && typeof j.error === "string" ? j.error : ""; } catch (e) {}
    return { error: true, status: r.status, message: msg };
  }

  const Feedback = {
    enabled: false,
    api() { return API; },
    async init() {
      const cfg = await window.RZ.load("data/config.json");
      const base = cfg && typeof cfg.feedback_api === "string" ? cfg.feedback_api.trim().replace(/\/+$/, "") : "";
      API = /^https?:\/\//.test(base) ? base : null;
      Feedback.enabled = !!API;
      if (API) {
        window.addEventListener("online", () => Feedback.flush());
        if (readQueue().length) Feedback.flush();
      }
      return Feedback.enabled;
    },
    reviewer() {
      const r = store.get(RKEY, null);
      return r && typeof r === "object" ? { name: String(r.name || ""), role: String(r.role || "") } : memReviewer;
    },
    setReviewer(o) {
      memReviewer = { name: String(o.name || "").slice(0, 60), role: String(o.role || "").slice(0, 60) };
      store.set(RKEY, memReviewer);
    },
    pending() { return readQueue().length; },
    onChange(fn) { listeners.push(fn); },

    async send(payload) {
      if (!API) return { state: "error" };
      const res = await post(payload);
      if (res.ok) { emit(); return { state: "sent", id: res.id }; }
      if (res.retry) {
        const q = readQueue(); q.push({ payload, at: Date.now() }); writeQueue(q);
        schedule(); emit();
        return { state: "queued" };
      }
      return { state: res.status === 429 ? "too_many" : "error", status: res.status, message: res.message };
    },

    async flush() {
      if (!API || flushing) return;
      flushing = true;
      try {
        const q = readQueue(), keep = [];
        for (const item of q) {
          const res = await post(item.payload);
          if (res.retry) keep.push(item);         // still unreachable: keep it
          // sent, or rejected for good (4xx): drop it
        }
        // anything queued while we were flushing stays too
        const now = readQueue(); const added = now.slice(q.length);
        writeQueue(keep.concat(added));
      } finally { flushing = false; }
      if (readQueue().length) schedule(); else if (timer) { clearInterval(timer); timer = null; }
      emit();
    },

    async list(recId) {
      if (!API) return null;
      try {
        const r = await fetch(API + "/feedback?rec_id=" + encodeURIComponent(recId), { cache: "no-store" });
        if (!r.ok) return null;
        const j = await r.json();
        const rows = Array.isArray(j) ? j : (j && j.items) || [];
        return rows.slice().sort((a, b) => String(b.received_at || "").localeCompare(String(a.received_at || "")));
      } catch (e) { return null; }
    },

    async counts(ids) {
      const out = {};
      if (!API || !ids.length) return out;
      const todo = ids.slice(0, 60);
      const worker = async () => { while (todo.length) { const id = todo.shift(); const l = await Feedback.list(id); if (l) out[id] = l.length; } };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return out;
    },
  };
  function schedule() { if (!timer) timer = setInterval(() => Feedback.flush(), 30000); }
  window.Feedback = Feedback;
})();
