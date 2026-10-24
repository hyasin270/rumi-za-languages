/* speak-page.js — the speaking review (speak.html).
 *
 * Data: data/speak/<lang>.json {lang, sentences:[{i,text,en,source}], voices:[{key,family,label_public,clips:[{i,mp3,words,cer,f0_rise}]}],
 *       shipped:{voice_key, clips:[{i,mp3,words,text?,en?,source?}]}, sources:[]}; data/config.json (feedback service).
 * Words: copy.json "speak.*"; the words this page shares with the listening review (name, role, status lines, privacy) fall back to
 * "review.*". A missing key shows a marked placeholder.
 * BLIND: each visitor hears the voices as Voice A–F in an order shuffled for them (seeded, kept on this device); which voice is which
 * is not put on the page until that visitor has sent a rating for that language. Links name a language and a sentence, never a voice.
 * URL: ?lang=<code> opens a language · &s=<sentence i> scrolls to that sentence and shows the "you were sent here" banner · &test=1
 * marks submissions as test rows. Nothing plays until the viewer presses play. Results stay counts-only until 3 reviewers have rated
 * a sentence. Every string a reviewer typed reaches the page as a text node, never as HTML.
 */
(async function () {
  const RZ = window.RZ, feedback = window.Feedback, el = RZ.el, $ = (id) => document.getElementById(id);
  const ORDER = ["zu", "xh", "st", "nso", "tn", "af"];
  const LETTERS = "ABCDEFGH";
  const MAX_REC_S = 20, MAX_REC_BYTES = 2 * 1024 * 1024;

  await RZ.boot({});
  const has = (k) => RZ.has(k);
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] !== undefined && v[k] !== null ? String(v[k]) : m));
  /** "speak.<k>", or "review.<fb>" for words shared with the listening review */
  const key = (k, fb) => (has("speak." + k) || !fb || !has("review." + fb) ? "speak." + k : "review." + fb);
  const T = (k, v, fb) => { const kk = key(k, fb); return has(kk) ? fill(RZ.t(kk), v) : STRUCT[k] ? fill(STRUCT[k], v) : `[copy: ${kk}]`; };
  // labels the page cannot work without (which voice, which sentence): shown as these until copy.json has its words
  const STRUCT = { "blind.voice": "Voice {letter}", "blind.sentence_label": "{n} / {total}", "shipped.item_label": "{n}" };
  const H = (k, v, fb) => { const kk = key(k, fb); return has(kk) ? RZ.inline(fill(RZ.raw(kk), v || {})) : STRUCT[k] ? RZ.esc(fill(STRUCT[k], v)) : RZ.placeholder(kk); };
  const setH = (node, k, v, fb) => { node.innerHTML = H(k, v, fb); return node; };
  const pctUp = (x) => (Math.ceil(Number(x) * 1000 - 1e-9) / 10).toFixed(1).replace(/\.0$/, "") + "%";   // error rates round up
  const mean1 = (a) => (a.length ? RZ.trunc(a.reduce((x, y) => x + y, 0) / a.length, 1) : "");          // scores never round up
  const params = new URLSearchParams(location.search);
  const TEST = params.get("test") === "1";

  /* ---------- this device (every access in try/catch; the page works without storage) ---------- */
  const mem = {};
  const store = {
    get(k, d) { try { const v = window.localStorage.getItem(k); return v === null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : d; } },
    set(k, v) { mem[k] = v; try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  let seed = store.get("rz.speak.seed", null);
  if (!Number.isInteger(seed)) { seed = Math.floor(Math.random() * 4294967296) >>> 0; store.set("rz.speak.seed", seed); }
  const revealed = () => store.get("rz.speak.revealed", {}) || {};
  const reveal = (l) => { const r = revealed(); r[l] = true; store.set("rz.speak.revealed", r); };

  /* ---------- the per-visitor order: mulberry32 seeded by (visitor seed, language) ---------- */
  function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
  function shuffled(lang, voices) {
    const a = voices.slice().sort((x, y) => String(x.key).localeCompare(String(y.key))), r = rng((seed ^ hash(lang)) >>> 0);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.map((v, n) => ({ v, letter: LETTERS[n] }));
  }

  /* ---------- page words ---------- */
  RZ.fillCopy();
  document.title = T("meta.title") + " — " + (RZ.t("index.meta.title") || "Rumi in South African languages");
  const steps = RZ.raw("speak.howto.steps");
  $("how-steps").innerHTML = Array.isArray(steps) ? steps.map((x) => `<li>${RZ.inline(x)}</li>`).join("") : `<li>${RZ.placeholder("speak.howto.steps")}</li>`;
  setH($("privacy-line"), "privacy.line", null, "privacy.line");

  /* ---------- reviewer (name required once, remembered on this device) ---------- */
  await feedback.init();
  const nameIn = $("rv-name"), roleIn = $("rv-role"), hp = $("rv-website");
  setH($("rv-who"), "identity.heading", null, "identity.heading");
  setH($("rv-name-label"), "identity.name_label", null, "identity.name_label");
  setH($("rv-role-label"), "identity.role_label", null, "identity.role_label");
  setH($("rv-remember"), "identity.remember_note", null, "identity.remember_note");
  const ph = (k) => (has(key(k, k)) ? T(k, null, k) : "");
  nameIn.placeholder = ph("identity.name_placeholder"); roleIn.placeholder = ph("identity.role_placeholder");
  const me = feedback.reviewer();
  nameIn.value = me.name; roleIn.value = me.role;
  const saveMe = () => feedback.setReviewer({ name: nameIn.value.trim(), role: roleIn.value.trim() });
  nameIn.addEventListener("change", saveMe); roleIn.addEventListener("change", saveMe);
  nameIn.addEventListener("input", () => { if (nameIn.value.trim()) { $("rv-name-err").hidden = true; nameIn.removeAttribute("aria-invalid"); } });
  $("reviewer").addEventListener("submit", (e) => e.preventDefault());
  function needName() {
    const n = nameIn.value.trim();
    if (n) { saveMe(); return n; }
    setH($("rv-name-err"), "identity.name_required", null, "identity.name_required").hidden = false;
    nameIn.setAttribute("aria-invalid", "true");
    nameIn.scrollIntoView({ block: "center", behavior: "smooth" });
    nameIn.focus({ preventScroll: true });
    return null;
  }
  if (!feedback.enabled) setH($("rv-closed"), "status.closed", null, "status.closed").hidden = false;
  const queueLine = () => {
    const n = feedback.pending(), q = $("rv-queue");
    q.hidden = !n;
    if (!n) return;
    q.innerHTML = "";
    q.append(el("span", { html: H("status.offline", null, "status.offline") }), " ",
      el("button", { type: "button", class: "btn small", onclick: () => feedback.flush(), html: H("status.retry", null, "status.retry") }));
  };
  feedback.onChange(queueLine);
  queueLine();
  const who = () => ({ name: nameIn.value.trim(), role: roleIn.value.trim() || undefined, page_url: location.href, hp: hp.value || undefined, test: TEST || undefined });

  /** Send rows one by one; paints statusNode; resolves "sent" | "queued" | null. */
  async function sendRows(rows, statusNode, btn) {
    if (!feedback.enabled) { setH(statusNode, "status.closed", null, "status.closed"); statusNode.className = "rv-status err"; return null; }
    btn.disabled = true;
    statusNode.className = "rv-status wait"; setH(statusNode, "status.sending", null, "status.sending");
    let queued = false, fail = null;
    for (const r of rows) {
      const res = await feedback.send(r);
      if (res.state === "queued") queued = true;
      else if (res.state !== "sent") { fail = res; break; }
    }
    btn.disabled = false;
    if (fail) {
      statusNode.className = "rv-status err";
      statusNode.innerHTML = "";
      if (fail.state === "too_many") statusNode.append(el("span", { html: H("status.too_many", null, "status.too_many") }));
      else statusNode.append(el("span", { html: H("status.error", null, "status.error") }), fail.message ? el("span", {}, " " + fail.message) : "");
      return null;
    }
    statusNode.className = queued ? "rv-status wait" : "rv-status ok";
    setH(statusNode, queued ? "status.queued" : "blind.sent", null, queued ? "status.queued" : "status.sent");
    return queued ? "queued" : "sent";
  }

  /* ---------- share (per language and per sentence; links never name a voice) ---------- */
  const pageUrl = () => location.origin + location.pathname;
  const linkFor = (l, i) => pageUrl() + "?lang=" + encodeURIComponent(l) + (i !== undefined && i !== null ? "&s=" + encodeURIComponent(i) : "");
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); return true; } catch (e) {}
    try {
      const ta = el("textarea", { readonly: true, style: "position:fixed;top:-1000px;left:0" }); ta.value = s; document.body.append(ta);
      ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function shareRow(l, i, n) {
    const v = { lang: RZ.langName(l), n, link: linkFor(l, i) };
    let msg = T(i === undefined ? "share.message" : "share.message_sentence", v);
    if (msg.indexOf(v.link) < 0) msg += " " + v.link;
    const subject = T("share.email_subject", v);
    const what = i === undefined ? v.lang : `${v.lang} ${n}`;
    const done = el("span", { class: "rv-copied", role: "status" });
    const copyBtn = el("button", { type: "button", class: "btn small", "aria-label": `${T("share.copy_link", null, "share.copy_link")} — ${what}`, html: H("share.copy_link", null, "share.copy_link"),
      onclick: async () => { const ok = await copyText(v.link); if (ok) { setH(done, "share.copied", null, "share.copied"); setTimeout(() => (done.innerHTML = ""), 2500); } else window.prompt(T("share.copy_link", null, "share.copy_link"), v.link); } });
    const wa = el("a", { class: "btn small", target: "_blank", rel: "noopener", href: "https://wa.me/?text=" + encodeURIComponent(msg),
      "aria-label": `${T("share.whatsapp", null, "share.whatsapp")} — ${what}`, html: H("share.whatsapp", null, "share.whatsapp") });
    const mail = el("a", { class: "btn small", href: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`,
      "aria-label": `${T("share.email", null, "share.email")} — ${what}`, html: H("share.email", null, "share.email") });
    return el("div", { class: "rv-share" }, i === undefined ? el("span", { class: "rv-share-label", html: H("share.heading", { lang: v.lang }) }) : "", copyBtn, wa, mail, done);
  }

  /* ---------- small controls ---------- */
  /** A 1–5 scale as a radio group of buttons; returns {node, value()} */
  function scale(labelKey, lowKey, highKey, onPick) {
    let val = null;
    const id = "sc-" + Math.random().toString(36).slice(2, 8);
    const btns = [1, 2, 3, 4, 5].map((n) => el("button", { type: "button", class: "btn small sp-n", role: "radio", "aria-checked": "false",
      "aria-label": `${n} / 5`, onclick: () => { val = val === n ? null : n; paint(); onPick && onPick(val); } }, String(n)));
    const paint = () => btns.forEach((b, j) => { const on = val === j + 1; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-pressed", String(on)); });
    const node = el("div", { class: "sp-scale" },
      el("span", { class: "sp-scale-l", id, html: H(labelKey) }),
      el("div", { class: "sp-scale-row", role: "radiogroup", "aria-labelledby": id }, ...btns),
      el("div", { class: "sp-ends", "aria-hidden": "true" }, el("span", { class: "sp-end", html: H(lowKey) }), el("span", { class: "sp-end", html: H(highKey) })));
    return { node, value: () => val };
  }
  const srcTag = (s) => (s ? el("span", { class: "sp-src", html: H("source." + s) }) : "");

  /* ---------- SAY IT RIGHT: the reviewer's own voice, kept privately (only where the browser can record) ---------- */
  const canRecord = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  function pickMime() {
    for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"]) {
      try { if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
    }
    return "";
  }
  function sayItRight(l, i) {
    if (!canRecord) return "";
    let blob = null, rec = null, stream = null, timer = null, started = 0;
    const consentId = `consent-${l}-${i}`;
    const consent = el("input", { type: "checkbox", id: consentId });
    const recBtn = el("button", { type: "button", class: "btn small", html: H("record.start") });
    const clock = el("span", { class: "sp-clock", "aria-live": "off" }, "");
    const preview = el("audio", { controls: true, preload: "none", hidden: true, class: "sp-preview" });
    const sendBtn = el("button", { type: "button", class: "btn small primary", disabled: true, html: H("record.send") });
    const status = el("span", { class: "rv-status", role: "status" });
    const ready = () => { sendBtn.disabled = !(blob && consent.checked); };
    consent.addEventListener("change", ready);
    const stopAll = () => { if (timer) clearInterval(timer); timer = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    recBtn.addEventListener("click", async () => {
      if (rec && rec.state === "recording") { rec.stop(); return; }
      status.textContent = ""; status.className = "rv-status";
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { status.className = "rv-status err"; setH(status, "record.denied"); return; }
      const mime = pickMime(), chunks = [];
      try { rec = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 32000 }, mime ? { mimeType: mime } : {})); }
      catch (e) { rec = new MediaRecorder(stream); }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stopAll();
        blob = new Blob(chunks, { type: (rec.mimeType || mime || "audio/webm").split(";")[0] });
        if (blob.size > MAX_REC_BYTES) { blob = null; status.className = "rv-status err"; setH(status, "record.too_long"); }
        else { preview.src = URL.createObjectURL(blob); preview.hidden = false; }
        setH(recBtn, blob ? "record.again" : "record.start"); recBtn.classList.remove("rec-on"); ready();
      };
      rec.start(); started = Date.now(); blob = null; ready(); preview.hidden = true;
      setH(recBtn, "record.stop"); recBtn.classList.add("rec-on");
      clock.textContent = "0:00 / 0:" + MAX_REC_S;
      timer = setInterval(() => {
        const s = (Date.now() - started) / 1000;
        clock.textContent = RZ.fmt(s) + " / 0:" + MAX_REC_S;
        if (s >= MAX_REC_S && rec.state === "recording") rec.stop();
      }, 250);
    });
    sendBtn.addEventListener("click", async () => {
      const name = needName();
      if (!name || !blob || !consent.checked) return;
      const api = feedback.api();
      if (!api) { status.className = "rv-status err"; setH(status, "status.closed", null, "status.closed"); return; }
      const fd = new FormData();
      const ext = /ogg/.test(blob.type) ? "ogg" : /mp4/.test(blob.type) ? "m4a" : "webm";
      fd.append("audio", blob, `say-it-right.${ext}`);
      const w = who();
      Object.entries({ rec_id: "speak-" + l, sentence_i: String(i), name: w.name, role: w.role || "", consent: "true", page_url: w.page_url, hp: w.hp || "" })
        .forEach(([k, v]) => fd.append(k, v));
      if (TEST) fd.append("test", "true");
      sendBtn.disabled = true; status.className = "rv-status wait"; setH(status, "status.sending", null, "status.sending");
      let r = null;
      try { r = await fetch(api + "/say-it-right", { method: "POST", body: fd }); } catch (e) {}
      if (r && (r.status === 201 || r.status === 200)) { status.className = "rv-status ok"; setH(status, "record.sent"); blob = null; preview.hidden = true; setH(recBtn, "record.start"); return; }
      sendBtn.disabled = false; status.className = "rv-status err";
      if (r && r.status === 429) setH(status, "status.too_many", null, "status.too_many");
      else { let msg = ""; try { const j = await r.json(); msg = j && typeof j.error === "string" ? j.error : ""; } catch (e) {} status.innerHTML = ""; status.append(el("span", { html: H("status.error", null, "status.error") }), msg ? el("span", {}, " " + msg) : ""); }
    });
    return el("details", { class: "sp-record" },
      el("summary", { html: H("record.heading") }),
      el("p", { class: "note", html: H("record.lead") }),
      el("div", { class: "sp-rec-row" }, recBtn, clock),
      preview,
      el("label", { class: "sp-check", for: consentId }, consent, el("span", { html: H("record.consent") })),
      el("div", { class: "rv-actions" }, sendBtn, status));
  }

  /* ---------- results: counts only until 3 reviewers have rated a sentence ---------- */
  const results = {};   // lang → {i: {reviewers, rows|null}}
  async function loadResults(l) {
    const api = feedback.api();
    if (!api) return null;
    let j = null;
    try { const r = await fetch(api + "/feedback?rec_id=" + encodeURIComponent("speak-" + l), { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (e) {}
    if (!j) return null;
    const out = {};
    const add = (i, n, rows) => { i = Number(i); if (!Number.isFinite(i)) return; out[i] = out[i] || { reviewers: 0, rows: null }; if (n) out[i].reviewers = Math.max(out[i].reviewers, Number(n) || 0); if (rows) out[i].rows = (out[i].rows || []).concat(rows); };
    const rowsOf = Array.isArray(j) ? j : Array.isArray(j.rows) ? j.rows : Array.isArray(j.items) && j.items.length && j.items[0].name !== undefined ? j.items : null;
    if (rowsOf) {
      const by = {};
      rowsOf.forEach((r) => { const i = Number(r.sentence_i); (by[i] = by[i] || []).push(r); });
      Object.entries(by).forEach(([i, rows]) => add(i, new Set(rows.map((r) => String(r.name || "").trim().toLowerCase())).size, rows));
    }
    const list = Array.isArray(j.sentences) ? j.sentences : Array.isArray(j.counts) ? j.counts : null;
    if (list) list.forEach((s) => add(s.sentence_i !== undefined ? s.sentence_i : s.i, s.reviewers !== undefined ? s.reviewers : s.n !== undefined ? s.n : s.count, Array.isArray(s.rows) ? s.rows : null));
    else if (j.counts && typeof j.counts === "object") Object.entries(j.counts).forEach(([i, c]) => add(i, typeof c === "object" ? c.reviewers || c.n || c.count : c, null));
    results[l] = out;
    return out;
  }
  function resultsNode(l, i, letterOf, part) {
    const r = (results[l] || {})[i];
    const box = el("div", { class: "sp-results" });
    if (!r || !r.reviewers) { box.append(el("p", { class: "note", html: H("results.none") })); return box; }
    if (r.reviewers < 3 || !r.rows) { box.append(el("p", { class: "note", html: H(r.reviewers === 1 ? "results.counts_one" : "results.counts", { n: r.reviewers }) })); return box; }
    if (part === "shipped") {
      const rows = (() => { const m = new Map(); r.rows.filter((x) => x.verdict).sort((a, b) => String(a.received_at).localeCompare(String(b.received_at))).forEach((x) => m.set(String(x.name || "").trim().toLowerCase(), x)); return [...m.values()]; })();   // latest verdict per reviewer
      const c = (v) => rows.filter((x) => x.verdict === v).length;
      box.append(el("p", { class: "note", html: H("results.shipped_line", { natural: c("natural"), not_natural: c("not_natural"), meaning_lost: c("meaning_lost"), english: rows.filter((x) => x.english_words === true || x.english_words === "true").length, n: rows.length }) }));
      return box;
    }
    // one rating per reviewer per voice (their latest), as the scorer counts them (QA4 FAIL 4)
    const who = (x) => String(x.name || "").trim().toLowerCase();
    const latest = (rows) => { const m = new Map(); rows.slice().sort((a, b) => String(a.received_at).localeCompare(String(b.received_at))).forEach((x) => m.set(who(x), x)); return [...m.values()]; };
    const count = (n, one, many) => (n === 1 ? H("results." + one) : H("results." + many, { n }));
    const score = (vals) => (vals.length ? H("results.score_of_5", { value: mean1(vals), count: count(vals.length, "rating_one", "ratings") }) : H("results.no_ratings"));
    const bestRows = latest(r.rows.filter((x) => x.best_voice_key));
    const items = Object.entries(letterOf).map(([vk, letter]) => {
      // latest non-empty value per reviewer PER FIELD, exactly as review_speak.py counts (a later save that leaves one field blank keeps the earlier one)
      const ok = (v) => v !== null && v !== undefined && v !== "" && Number(v) >= 1 && Number(v) <= 5;
      const mine = r.rows.filter((x) => x.voice_key === vk && !x.verdict);
      const nat = latest(mine.filter((x) => ok(x.natural))).map((x) => Number(x.natural));
      const mea = latest(mine.filter((x) => ok(x.meaning))).map((x) => Number(x.meaning));
      const best = bestRows.filter((x) => x.best_voice_key === vk).length;
      return { letter, html: H("results.voice_line", { letter, natural: score(nat), meaning: score(mea), best: best ? count(best, "vote_one", "votes") : H("results.vote_none") }) };
    }).sort((a, b) => a.letter.localeCompare(b.letter));
    box.append(el("p", { class: "subcard-title", html: H("results.heading", { n: r.reviewers }) }), el("ul", { class: "bullets" }, ...items.map((x) => el("li", { html: x.html }))), el("p", { class: "note", html: H("results.latest_note") }));
    return box;
  }

  /* ---------- one language ---------- */
  const cache = {};
  // 24 Oct: a sentence rewritten from a first-language reviewer's corrections stays in the data ("retired", what earlier reviewers
  // rated) but is not shown; links to it land on its replacement ("replaced_by").
  const RETIRED = {};   // lang → {old i: new i}
  const liveOnly = (l, d) => {
    if (!d || !Array.isArray(d.sentences)) return d;
    RETIRED[l] = {};
    d.sentences.forEach((s) => { if (s.retired && s.replaced_by !== undefined) RETIRED[l][String(s.i)] = String(s.replaced_by); });
    const live = new Set(d.sentences.filter((s) => !s.retired).map((s) => Number(s.i)));
    d.sentences = d.sentences.filter((s) => !s.retired);
    (d.voices || []).forEach((v) => { v.clips = (v.clips || []).filter((c) => live.has(Number(c.i))); });
    if (d.shipped && Array.isArray(d.shipped.clips)) d.shipped.clips = d.shipped.clips.filter((c) => live.has(Number(c.i)));
    return d;
  };
  const loadLang = async (l) => (l in cache ? cache[l] : (cache[l] = liveOnly(l, await RZ.load(`data/speak/${l}.json`))));
  let lang = null;

  function renderTabs(ready) {
    const nav = $("lang-tabs");
    nav.innerHTML = "";
    ORDER.forEach((l) => nav.append(el("button", { type: "button", class: "rv-tab", "aria-pressed": String(l === lang), lang: l,
      onclick: () => go(l) }, RZ.langName(l), ready[l] ? "" : el("span", { class: "n", html: H("tabs.soon") }))));
  }

  function renderKey(l, data, order) {
    const box = $("key-box");
    box.innerHTML = "";
    if (!revealed()[l]) { box.append(el("p", { class: "note sp-locked", html: H("key.locked") })); return; }
    const items = order.map(({ v, letter }) => {
      const cers = (v.clips || []).map((c) => Number(c.cer)).filter((x) => Number.isFinite(x));
      const cer = cers.length ? pctUp(cers.reduce((a, b) => a + b, 0) / cers.length) : "";
      const fam = has("speak.blind.family." + v.family) ? RZ.t("speak.blind.family." + v.family) : "";
      return el("li", {}, el("strong", {}, T("blind.voice", { letter })), " — ", el("span", {}, [v.label_public, fam && fam !== v.label_public ? fam : ""].filter(Boolean).join(" · ")),
        cer && has("speak.key.cer") ? el("span", { class: "note" }, " · " + T("key.cer", { pct: cer })) : "");
    });
    const ref = data.measures && data.measures.f0_rise_human_ref && data.measures.f0_rise_human_ref.line;
    box.append(el("div", { class: "card sp-key" }, el("p", { class: "subcard-title", html: H("key.heading") }), el("ul", { class: "bullets" }, ...items),
      has("speak.key.note") ? el("p", { class: "note", html: H("key.note") }) : "",
      has("speak.blind.clip_line_note") ? el("p", { class: "note", html: H("blind.clip_line_note") }) : "",
      ref ? el("p", { class: "note" }, ref) : ""));
  }

  /** After this visitor's first save for a language: each voice's name and its clip's measured round trip + pitch proxy. */
  function paintReveal(l, data) {
    if (!revealed()[l]) return;
    const byKey = Object.fromEntries((data.voices || []).map((v) => [v.key, v]));
    document.querySelectorAll("#blind-host .sp-reveal").forEach((n) => {
      const v = byKey[n.dataset.k]; if (!v) return;
      const c = (v.clips || []).find((x) => String(x.i) === n.dataset.i) || {};
      const fam = has("speak.blind.family." + v.family) ? RZ.t("speak.blind.family." + v.family) : "";
      const f0 = Number(c.f0_rise), cer = Number(c.cer);
      const nums = Number.isFinite(cer) && Number.isFinite(f0) ? T("blind.clip_line", { cer: pctUp(cer), f0: (f0 > 0 ? "+" : "") + RZ.trunc(f0, 1) }) : Number.isFinite(cer) && has("speak.key.cer") ? T("key.cer", { pct: pctUp(cer) }) : "";
      n.textContent = "";
      n.append(el("span", { class: "sp-name" }, [v.label_public, fam && fam !== v.label_public ? fam : ""].filter(Boolean).join(" · ")), nums ? el("span", { class: "sp-nums" }, nums) : "");
    });
  }

  function blindCard(l, data, s, n, total, order, letterOf) {
    const id = `s-${s.i}`;
    const card = el("article", { class: "card sp-sent", id, tabindex: "-1", "aria-labelledby": id + "-h" });
    const shareBtn = el("button", { type: "button", class: "btn small fb-share", "aria-expanded": "false", html: H("share.sentence_button") });
    const sharePanel = shareRow(l, s.i, n); sharePanel.hidden = true;
    shareBtn.addEventListener("click", () => { sharePanel.hidden = !sharePanel.hidden; shareBtn.setAttribute("aria-expanded", String(!sharePanel.hidden)); });
    card.append(el("div", { class: "sp-head" }, el("h3", { id: id + "-h", html: H("blind.sentence_label", { n, total }) }), srcTag(s.source), shareBtn), sharePanel,
      el("p", { class: "sp-text", lang: l }, s.text || ""), s.en ? el("p", { class: "sp-en" }, s.en) : "",
      el("p", { class: "rv-hint", html: H("blind.flag_hint") }));
    const state = {};
    const list = el("ol", { class: "sp-voices" });
    order.forEach(({ v, letter }) => {
      const clip = (v.clips || []).find((c) => Number(c.i) === Number(s.i));
      if (!clip) return;
      const st = (state[v.key] = { flags: new Set(), nat: null, mea: null });
      const li = el("li", { class: "sp-voice" });
      const flagged = el("span", { class: "sp-flagged", "aria-live": "polite" });
      const who_ = el("span", { class: "sp-reveal", "data-k": v.key, "data-i": s.i });
      li.append(el("div", { class: "sp-vhead" }, el("strong", {}, T("blind.voice", { letter })), who_, flagged));
      const k = window.Karaoke.mount(li, { mp3: clip.mp3, words: Array.isArray(clip.words) ? clip.words : [], text: s.text, lang: l, compact: true,
        label: T("blind.voice", { letter }),
        onWord: (wi, span) => {
          if (st.flags.has(wi)) st.flags.delete(wi); else st.flags.add(wi);
          span.classList.toggle("flag", st.flags.has(wi)); span.setAttribute("aria-pressed", String(st.flags.has(wi)));
          flagged.innerHTML = st.flags.size ? H(st.flags.size === 1 ? "blind.flagged_one" : "blind.flagged", { n: st.flags.size }) : "";
        } });
      if (k && k.spans) k.spans.forEach((sp) => { sp.setAttribute("role", "button"); sp.setAttribute("tabindex", "0"); sp.setAttribute("aria-pressed", "false");
        sp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sp.click(); } }); });
      const a = scale("blind.natural_label", "blind.scale_low", "blind.scale_high", (x) => (st.nat = x));
      const mEnds = has("speak.blind.meaning_low") && has("speak.blind.meaning_high") ? ["blind.meaning_low", "blind.meaning_high"] : ["blind.scale_low", "blind.scale_high"];
      const b = scale("blind.meaning_label", mEnds[0], mEnds[1], (x) => (st.mea = x));
      li.append(el("div", { class: "sp-scales" }, a.node, b.node));
      list.append(li);
    });
    card.append(list);
    // best voice for this sentence
    let best = null;
    const bestBtns = order.filter(({ v }) => (v.clips || []).some((c) => Number(c.i) === Number(s.i))).map(({ v, letter }) =>
      el("button", { type: "button", class: "btn small sp-best", role: "radio", "aria-checked": "false", "aria-pressed": "false", "data-k": v.key,
        onclick: (e) => { best = best === v.key ? null : v.key; bestBtns.forEach((x) => { const on = x.dataset.k === best; x.setAttribute("aria-checked", String(on)); x.setAttribute("aria-pressed", String(on)); }); } }, letter));
    const bestId = id + "-best";
    card.append(el("div", { class: "sp-bestrow" }, el("span", { class: "sp-scale-l", id: bestId, html: H("blind.best_label") }),
      el("div", { class: "sp-scale-row", role: "radiogroup", "aria-labelledby": bestId }, ...bestBtns)));
    const betterId = id + "-better";
    const better = el("textarea", { id: betterId, rows: "2", maxlength: "2000", placeholder: has("speak.blind.better_placeholder") ? T("blind.better_placeholder") : "" });
    card.append(el("div", { class: "fb-form sp-better" }, el("label", { for: betterId, html: H("blind.better_label") }), better));
    const record = sayItRight(l, s.i);
    if (record) card.append(record);
    const status = el("span", { class: "rv-status", role: "status" });
    const send = el("button", { type: "button", class: "btn primary", html: H("blind.submit") });
    send.addEventListener("click", async () => {
      const name = needName();
      if (!name) return;
      const base = Object.assign({ kind: "speaking", rec_id: "speak-" + l, sentence_i: s.i }, who());
      const rows = [];
      Object.entries(state).forEach(([vk, st]) => {
        if (!st.nat && !st.mea && !st.flags.size) return;
        rows.push(Object.assign({}, base, { voice_key: vk, natural: st.nat || undefined, meaning: st.mea || undefined, flagged_words: st.flags.size ? [...st.flags].sort((x, y) => x - y) : undefined }));
      });
      const bw = better.value.trim();
      if (best || bw) rows.push(Object.assign({}, base, { best_voice_key: best || undefined, better_wording: bw || undefined }));
      if (!rows.length) { status.className = "rv-status err"; setH(status, "blind.need_rating"); return; }
      const res = await sendRows(rows, status, send);
      if (res) { const first = !revealed()[l]; reveal(l); renderKey(l, data, order); paintReveal(l, data); if (first) renderShipped(l, data); }
    });
    card.append(el("div", { class: "rv-actions" }, send, status));
    card.append(resultsNode(l, s.i, letterOf, "blind"));
    return card;
  }

  function shippedCard(l, data, c, n) {
    const s = (data.sentences || []).find((x) => Number(x.i) === Number(c.i)) || {};
    const text = c.text || s.text || "", en = c.en || s.en || "", source = c.source || s.source;
    const id = `shipped-${c.i}`;
    const card = el("article", { class: "card sp-sent", id, tabindex: "-1" });
    const flags = new Set();
    const flagged = el("span", { class: "sp-flagged", "aria-live": "polite" });
    card.append(el("div", { class: "sp-head" }, el("h3", { html: H("shipped.item_label", { n }) }), srcTag(source), flagged));
    const k = window.Karaoke.mount(card, { mp3: c.mp3, words: Array.isArray(c.words) ? c.words : [], text, en, lang: l, label: T("shipped.item_label", { n }),
      onWord: (wi, span) => {
        if (flags.has(wi)) flags.delete(wi); else flags.add(wi);
        span.classList.toggle("flag", flags.has(wi)); span.setAttribute("aria-pressed", String(flags.has(wi)));
        flagged.innerHTML = flags.size ? H(flags.size === 1 ? "blind.flagged_one" : "blind.flagged", { n: flags.size }) : "";
      } });
    if (k && k.spans) k.spans.forEach((sp) => { sp.setAttribute("role", "button"); sp.setAttribute("tabindex", "0"); sp.setAttribute("aria-pressed", "false");
      sp.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sp.click(); } }); });
    card.append(el("p", { class: "rv-hint", html: H("blind.flag_hint") }));
    const VERD = [["natural", "fb-right"], ["not_natural", "fb-unsure"], ["meaning_lost", "fb-wrong"]];
    let verdict = null;
    const vb = VERD.map(([v, cls]) => el("button", { type: "button", class: `btn small fb-v ${cls}`, "aria-pressed": "false", "data-v": v, html: H("shipped." + v),
      onclick: () => { verdict = verdict === v ? null : v; vb.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === verdict))); } }));
    card.append(el("div", { class: "fb-row sp-verdicts" }, ...vb));
    const engId = id + "-eng";
    const eng = el("input", { type: "checkbox", id: engId });
    card.append(el("label", { class: "sp-check", for: engId }, eng, el("span", { html: H("shipped.english_words") })));
    const betterId = id + "-better";
    const better = el("textarea", { id: betterId, rows: "2", maxlength: "2000", placeholder: has("speak.shipped.better_placeholder") ? T("shipped.better_placeholder") : "" });
    card.append(el("div", { class: "fb-form sp-better" }, el("label", { for: betterId, html: H("shipped.better_label") }), better));
    const status = el("span", { class: "rv-status", role: "status" });
    const send = el("button", { type: "button", class: "btn primary", html: H("shipped.submit") });
    send.addEventListener("click", async () => {
      const name = needName();
      if (!name) return;
      const bw = better.value.trim();
      if (!verdict && !flags.size && !bw && !eng.checked) { status.className = "rv-status err"; setH(status, "blind.need_rating"); return; }
      const row = Object.assign({ kind: "speaking", rec_id: "speak-" + l, sentence_i: c.i, voice_key: (data.shipped || {}).voice_key || undefined }, who(),
        { verdict: verdict || undefined, flagged_words: flags.size ? [...flags].sort((x, y) => x - y) : undefined, better_wording: bw || undefined, english_words: eng.checked });
      const res = await sendRows([row], status, send);
      if (res) reveal(l);
    });
    card.append(el("div", { class: "rv-actions" }, send, status));
    card.append(resultsNode(l, c.i, {}, "shipped"));
    return card;
  }

  /** Rumi's shipped voice notes: locked until this visitor has saved a blind rating in this language (the shipped voice is
   *  also one of the blind voices, so hearing it first would unblind the comparison). */
  function renderShipped(l, data) {
    const sh = $("shipped-host"), shipped = (data.shipped && data.shipped.clips) || [];
    sh.innerHTML = "";
    if (!revealed()[l]) { sh.append(el("p", { class: "note sp-locked card", html: H("shipped.locked") })); return; }
    shipped.forEach((c, n) => sh.append(shippedCard(l, data, c, n + 1)));
  }

  async function render(l, fromLink) {
    lang = l;
    renderTabs(READY);
    const data = await loadLang(l);
    if (lang !== l) return;
    const ls = $("lang-share"); ls.innerHTML = ""; ls.append(shareRow(l));
    const bh = $("blind-host"), sh = $("shipped-host");
    bh.innerHTML = ""; sh.innerHTML = ""; $("key-box").innerHTML = "";
    if (!data || !Array.isArray(data.sentences) || !data.sentences.length) {
      bh.innerHTML = `<div class="soon" role="status">${H("missing", { lang: RZ.langName(l) })}</div>`;
      $("shipped").hidden = true;
      return;
    }
    // word timings may be inline or a path to a JSON file
    const clips = (data.voices || []).flatMap((v) => v.clips || []).concat((data.shipped && data.shipped.clips) || []);
    await Promise.all([loadResults(l), ...clips.filter((c) => typeof c.words === "string").map(async (c) => (c.words = await RZ.words(c.words)))]);
    if (lang !== l) return;
    const order = shuffled(l, (data.voices || []).filter((v) => v && v.key));
    const letterOf = Object.fromEntries(order.map(({ v, letter }) => [v.key, letter]));
    renderKey(l, data, order);
    (data.notes || []).forEach((t) => bh.append(el("p", { class: "note" }, t)));
    const total = data.sentences.length;
    data.sentences.forEach((s, n) => bh.append(blindCard(l, data, s, n + 1, total, order, letterOf)));
    const shipped = (data.shipped && data.shipped.clips) || [];
    $("shipped").hidden = !shipped.length;
    renderShipped(l, data);
    paintReveal(l, data);
    if ((data.sources || []).length) bh.append(el("p", { class: "note", html: `${RZ.esc(RZ.ui("sources_label", "Sources"))} ${RZ.cite(data.sources)}` }));
    RZ.renderFootnotes($("fn-host"));
    // deep link to a sentence: banner + scroll; nothing plays
    let sp = params.get("s");
    if (sp !== null && RETIRED[l] && RETIRED[l][sp] !== undefined) sp = RETIRED[l][sp];   // an old link to a rewritten sentence
    const banner = $("banner");
    banner.hidden = true;
    if (fromLink && sp !== null && sp !== "") {
      const target = document.getElementById("s-" + sp);
      if (target) {
        target.classList.add("linked");
        banner.innerHTML = "";
        banner.append(el("span", { html: H("banner.deeplink", { n: data.sentences.findIndex((x) => String(x.i) === sp) + 1, lang: RZ.langName(l) }) }),
          el("button", { type: "button", class: "btn small rv-x", html: H("banner.dismiss", null, "banner.dismiss"), onclick: () => (banner.hidden = true) }));
        banner.hidden = false;
        setTimeout(() => { target.scrollIntoView({ block: "start" }); target.focus({ preventScroll: true }); }, 60);
      }
    }
  }

  function go(l) {
    store.set("rz.speak.lang", l);
    const u = new URL(location.href);
    u.searchParams.set("lang", l); u.searchParams.delete("s");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    params.delete("s");
    render(l, false);
  }

  // which languages have their voices ready (tabs mark the rest "coming shortly")
  const READY = {};
  await Promise.all(ORDER.map(async (l) => { const d = await loadLang(l); READY[l] = !!(d && Array.isArray(d.sentences) && d.sentences.length); }));
  const asked = params.get("lang");
  const remembered = store.get("rz.speak.lang", null);
  const first = ORDER.includes(asked) ? asked : ORDER.includes(remembered) ? remembered : ORDER.find((l) => READY[l]) || ORDER[0];
  await render(first, ORDER.includes(asked));
})();
