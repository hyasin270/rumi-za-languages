/* review-page.js — the listening review (review.html).
 *
 * Data: data/review/index.json (the recordings), data/review/<id>.json (transcript), data/review/<id>.coach.json (coaching, when
 * has_coaching), data/config.json (feedback service). Words: copy.json "review.*" (a missing key shows a marked placeholder).
 * URL: ?lang=<code> filters the list · ?r=<id> opens a recording · &t=<seconds or m:ss> / &turn=<i> open it at that moment, highlight
 * the turn and show the "you were sent here" banner. Nothing plays until the viewer presses play.
 * Every string a reviewer typed reaches the page as a text node (RZ.el), never as HTML. Names never go into a URL.
 */
(async function () {
  const RZ = window.RZ, feedback = window.Feedback, el = RZ.el, $ = (id) => document.getElementById(id);
  const ORDER = ["zu", "xh", "st", "nso", "tn", "af", "en"];
  RZ.LANGS.en = RZ.LANGS.en || "English";

  await RZ.boot({});
  const has = (k) => RZ.has(k);
  /** plain text for a key (vars filled); a clearly marked placeholder while the words are pending */
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] !== undefined && v[k] !== null ? String(v[k]) : m));
  const T = (k, v) => (has(k) ? fill(RZ.t(k), v) : `[copy: ${k}]`);
  const H = (k, v) => (has(k) ? RZ.inline(fill(RZ.raw(k), v || {})) : RZ.placeholder(k));
  const setH = (node, k, v) => { node.innerHTML = H(k, v); return node; };
  const pageUrl = () => location.origin + location.pathname;
  const linkFor = (id, extra) => pageUrl() + "?r=" + encodeURIComponent(id) + (extra || "");
  const minutes = (d) => Math.max(1, Math.ceil((Number(d) || 0) / 60 - 1e-9));   // rounded UP: a 4:41 recording is "5 min"
  const pctUp = (x) => (Math.ceil(Number(x) * 1000 - 1e-9) / 10).toFixed(1).replace(/\.0$/, "") + "%";  // error rates round up
  const kindText = (k) => (k ? (has("review.card.kind." + k) ? RZ.t("review.card.kind." + k) : k.replace(/_/g, " ")) : "");
  const recTitle = (r) => r.title_en || r.title || r.id;
  const turnKey = (x, j) => (x.i !== undefined && x.i !== null ? Number(x.i) : j);

  RZ.fillCopy();
  const baseTitle = () => T("review.meta.title") + " — " + (RZ.t("index.meta.title") || "Rumi in South African languages");
  document.title = baseTitle();
  // how-to steps (numbered) and the score-label legend
  const steps = RZ.raw("review.howto.steps");
  $("how-steps").innerHTML = Array.isArray(steps) ? steps.map((x) => `<li>${RZ.inline(x)}</li>`).join("") : `<li>${RZ.placeholder("review.howto.steps")}</li>`;
  $("labels-list").innerHTML = ["measured", "proxy", "ai_judged", "pending", "read_sentence"].filter((k) => has("review.scores." + k)).map((k) => `<li>${H("review.scores." + k)}</li>`).join("");

  const [index] = await Promise.all([RZ.load("data/review/index.json"), feedback.init()]);
  const RECS = ((index && index.recordings) || []).filter((r) => r && r.id && r.lang);
  const byId = Object.fromEntries(RECS.map((r) => [r.id, r]));
  const langsPresent = ORDER.filter((l) => RECS.some((r) => r.lang === l)).concat([...new Set(RECS.map((r) => r.lang))].filter((l) => !ORDER.includes(l)));

  /* ---------- scores: the chip text says what the number is ----------
   * Proxy = two engines compared (engine agreement); AI-judged = a model scored it (the meaning check); measured = against a
   * same-language reference. The chip carries that word, and its one-line meaning (review.labels.<kind>_meaning). */
  function kindOf(label) {
    const k = String(label || "").toLowerCase();
    if (k.includes("ai-judged")) return "ai";
    if (k.includes("engine agreement") || k.includes("proxy")) return "proxy";
    if (k.includes("measured")) return "measured";
    if (k.includes("pending") || k.includes("not run")) return "pending";
    return RZ.labelOf(label)[1] || "";
  }
  const LABEL_KEY = { proxy: "proxy", ai: "ai_judged", measured: "measured", pending: "pending" };
  const chipWord = (cls) => (LABEL_KEY[cls] ? T("review.labels." + LABEL_KEY[cls]) : "");
  const chipMeaning = (cls) => (LABEL_KEY[cls] && has("review.labels." + LABEL_KEY[cls] + "_meaning") ? RZ.t("review.labels." + LABEL_KEY[cls] + "_meaning") : "");
  // the chip already names the label, so a display's trailing "(proxy)" / "(measured)" / "(AI-judged)" is dropped
  const bareDisplay = (d) => String(d).replace(/\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*$/, (m, x) => (/proxy|measured|ai-judged|automated/i.test(x) ? "" : m));
  function scoreChip(sc) {
    const none = `<span class="chip pending"><span class="v">${RZ.esc(T("review.scores.no_score"))}</span></span>`;
    if (!sc) return none;
    const s = RZ.score(sc), cls = kindOf(s.label), n = Number(s.value);
    let txt;
    if (s.display) txt = bareDisplay(s.display);
    else if (s.value === null || s.value === undefined || Number.isNaN(n)) return none;
    // a proxy value is engine AGREEMENT (1 − CER): show the disagreement, rounded up; a measured value is a CER
    else if (cls === "proxy" && n <= 1) txt = T("review.scores.agreement_label", { pct: pctUp(1 - n) });
    else if (n <= 1) txt = T("review.scores.cer_label", { pct: pctUp(n) });
    else txt = RZ.trunc(n, 1) + "/10";
    const word = chipWord(cls), mean = chipMeaning(cls);
    return `<span class="chip ${cls}"${mean ? ` title="${RZ.esc(mean)}"` : ""}><span class="v rv-v">${RZ.esc(txt)}</span>${word ? `<span class="l">${RZ.esc(word)}</span>` : ""}</span>`;
  }
  /** A score's own line without its trailing silence sentence (the page prints that once, below, in its own words). */
  const SILENCE_RE = /\s*\d+ lines? the engine heard in silence (?:were|was) removed\.?/gi;
  const silenceLine = (n) => (n > 0 ? T(n === 1 ? "review.scores.removed_in_silence_one" : "review.scores.removed_in_silence", { n }) : "");

  /* ---------- names: a word typed against [learner] / [teacher] / [school] shows as that placeholder ----------
   * The same word-by-word alignment the feedback service applies before it returns a row; used here for the reviewer's own
   * copy shown straight after Save, so a child's name never appears on the page even for a moment.
   * One correction word per placeholder slot (adjacent placeholders take one word each); words around it are never folded in,
   * and a word that occurs in the recording's own transcript is never treated as a name. */
  const PH_RE = /\[(?:learner|teacher|school)\]/;
  const EDGE = /^[^\p{L}\p{N}[\]]*([\s\S]*?)[^\p{L}\p{N}[\]]*$/u, UPPER = /\p{Lu}/u;
  const parts = (tok) => { const core = tok.match(EDGE)[1], s = tok.indexOf(core); return { pre: tok.slice(0, s), core, post: tok.slice(s + core.length) }; };
  const words = (s) => String(s || "").split(/\s+/).filter(Boolean);
  const wkey = (tok) => parts(tok).core.toLowerCase();
  const isPh = (tok) => PH_RE.test(tok);
  // longest common subsequence on normalised words; a placeholder never matches a word
  function matches(a, b) {
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    const same = (i, j) => !isPh(b[j]) && wkey(a[i]) !== "" && wkey(a[i]) === wkey(b[j]);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = same(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (same(i, j)) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
    return out;
  }
  const asPh = (turnTok, corrTok) => parts(turnTok).pre.replace(/^\W+/, "") + parts(turnTok).core + parts(corrTok).post;
  // one unmatched block: each placeholder takes the single word in its own slot, counted from the nearer edge of the block
  // (on a tie, from the edge that is a matched word rather than the start or end of the text)
  function blockMap(cs, ts, ci, fromLeft) {
    if (!cs.length) return [];
    const out = [], used = new Set();
    ts.forEach((t, k) => {
      if (!isPh(t)) return;
      const right = ts.length - 1 - k;
      const left = cs.length === ts.length || k < right || (k === right && fromLeft);
      const idx = left ? Math.min(k, cs.length - 1) : Math.max(0, cs.length - 1 - right);
      if (used.has(idx)) return;
      used.add(idx); out.push({ at: ci + idx, to: t });
    });
    return out;
  }
  function plan(text, turnText) {
    const cs = words(text), ts = words(turnText), anchors = [...matches(cs, ts), [cs.length, ts.length]], maps = [];
    let pi = 0, pj = 0;
    for (const [i, j] of anchors) { maps.push(...blockMap(cs.slice(pi, i), ts.slice(pj, j), pi, pi > 0 || i >= cs.length)); pi = i + 1; pj = j + 1; }
    return { cs, maps };
  }
  function alignPlaceholders(text, turnText) {
    if (!text || !turnText || !PH_RE.test(turnText)) return text || "";
    const { cs, maps } = plan(text, turnText), out = cs.slice();
    for (const { at, to } of maps) out[at] = asPh(to, cs[at]);
    return out.join(" ");
  }
  const tailOf = (core) => core.replace(/^\p{Ll}+(?=\p{Lu})/u, ""); // "eSizwe" → also "Sizwe"
  function namesFrom(text, turnText, vocab) {
    const names = new Map();
    if (!text || !turnText || !PH_RE.test(turnText)) return names;
    const { cs, maps } = plan(text, turnText);
    for (const { at, to } of maps) {
      const core = parts(cs[at]).core;
      if (!UPPER.test(core) || isPh(core)) continue;
      const ph = to.match(PH_RE)[0];
      for (const w of new Set([core, tailOf(core)])) if (!vocab.has(w.toLowerCase())) names.set(w.toLowerCase(), ph);
    }
    return names;
  }
  function scrubNames(text, names) {
    if (!text || !names.size) return text || "";
    return String(text).split(/(\s+)/).map((tok) => {
      if (/^\s*$/.test(tok)) return tok;
      const p = parts(tok);
      if (!UPPER.test(p.core)) return tok;
      const ph = names.get(p.core.toLowerCase()) || names.get(tailOf(p.core).toLowerCase());
      return ph ? p.pre + ph + p.post : tok;
    }).join("");
  }
  /** Every word of the open recording's transcript (text and gloss): never a name. */
  const transcriptWords = () => {
    const v = new Set();
    ((player && player.turns) || []).forEach((tu) => [tu.text, tu.en, tu.gloss].forEach((s) => words(s).forEach((w) => v.add(wkey(w)))));
    return v;
  };
  /** The reviewer's own submission as the page may show it. */
  function shownCopy(body) {
    if (!body.turn_text) return body;
    const names = namesFrom(body.correction, body.turn_text, transcriptWords());
    return Object.assign({}, body, {
      correction: body.correction ? scrubNames(alignPlaceholders(body.correction, body.turn_text), names) : body.correction,
      note: body.note ? scrubNames(body.note, names) : body.note,
    });
  }

  /* ---------- reviewer (name required, remembered on this device only) ---------- */
  const nameIn = $("rv-name"), roleIn = $("rv-role"), hp = $("rv-website");
  setH($("rv-name-label"), "review.identity.name_label");
  setH($("rv-role-label"), "review.identity.role_label");
  nameIn.placeholder = has("review.identity.name_placeholder") ? RZ.t("review.identity.name_placeholder") : "";
  roleIn.placeholder = has("review.identity.role_placeholder") ? RZ.t("review.identity.role_placeholder") : "";
  const me = feedback.reviewer();
  nameIn.value = me.name; roleIn.value = me.role;
  const saveMe = () => feedback.setReviewer({ name: nameIn.value.trim(), role: roleIn.value.trim() });
  nameIn.addEventListener("change", saveMe); roleIn.addEventListener("change", saveMe);
  nameIn.addEventListener("input", () => { if (nameIn.value.trim()) { $("rv-name-err").hidden = true; nameIn.removeAttribute("aria-invalid"); } });
  $("reviewer").addEventListener("submit", (e) => e.preventDefault());
  function needName() {
    const n = nameIn.value.trim();
    if (n) return n;
    setH($("rv-name-err"), "review.identity.name_required").hidden = false;
    nameIn.setAttribute("aria-invalid", "true");
    nameIn.scrollIntoView({ block: "center", behavior: "smooth" });
    nameIn.focus({ preventScroll: true });
    return null;
  }
  if (!feedback.enabled) setH($("rv-closed"), "review.status.closed").hidden = false;
  const queueLine = () => {
    const n = feedback.pending(), q = $("rv-queue");
    q.hidden = !n;
    if (!n) return;
    q.innerHTML = "";
    q.append(el("span", { html: H("review.status.offline") }), " ",
      el("button", { type: "button", class: "btn small", onclick: () => feedback.flush(), html: H("review.status.retry") }));
  };
  feedback.onChange(queueLine);
  queueLine();

  /** Send one submission; paints statusNode; resolves "sent" | "queued" | null (failed: the reviewer's words stay in the box). */
  async function submit(payload, statusNode, btn, okKey) {
    if (!feedback.enabled || !current) return null;
    const name = needName();
    if (!name) return null;
    saveMe();
    const rec = current;
    const body = Object.assign({ rec_id: rec.id, name, role: roleIn.value.trim() || undefined, page_url: location.href, hp: hp.value || undefined }, payload);
    if (btn) btn.disabled = true;
    setH(statusNode, "review.status.sending"); statusNode.className = "rv-status";
    const res = await feedback.send(body);
    if (btn) btn.disabled = false;
    if (res.state === "sent" || res.state === "queued") {
      setH(statusNode, res.state === "sent" ? okKey : "review.status.offline");
      statusNode.className = "rv-status " + (res.state === "sent" ? "ok" : "wait");
      // the service caches GET for a few seconds: show the reviewer's own words straight away
      if (current === rec) addComment(Object.assign({}, shownCopy(body), { received_at: new Date().toISOString(), pending: res.state === "queued" }), true);
      return res.state;
    }
    statusNode.innerHTML = ""; statusNode.className = "rv-status err";
    if (res.state === "too_many") statusNode.append(el("span", { html: H("review.status.too_many") }));
    else statusNode.append(el("span", { html: H("review.status.error") }), res.message ? el("span", { class: "rv-why" }, String(res.message)) : "", " ",
      el("button", { type: "button", class: "btn small", html: H("review.status.retry"), onclick: () => submit(payload, statusNode, btn, okKey) }));
    return null;
  }

  /* ---------- share (per recording and per turn) ---------- */
  function shareText(rec, turn) {
    const v = { lang: RZ.langName(rec.lang), title: recTitle(rec), min: minutes(rec.duration), time: turn ? RZ.fmt(turn.start) : "",
      link: turn ? linkFor(rec.id, `&t=${Math.floor(turn.start)}&turn=${turnKey(turn, turn.idx)}`) : linkFor(rec.id) };
    let msg = T(turn ? "review.share.message_turn" : "review.share.message", v);
    if (msg.indexOf(v.link) < 0) msg += " " + v.link;
    return { msg, link: v.link, subject: T("review.share.email_subject", v) };
  }
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); return true; } catch (e) {}
    try {
      const ta = el("textarea", { readonly: true, style: "position:fixed;top:-1000px;left:0" }); ta.value = s; document.body.append(ta);
      ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function shareRow(rec, turn) {
    const x = shareText(rec, turn);
    const what = turn ? RZ.fmt(turn.start) : recTitle(rec);
    const done = el("span", { class: "rv-copied", role: "status" });
    const copyBtn = el("button", { type: "button", class: "btn small", "aria-label": `${T("review.share.copy_link")} — ${what}`, html: H("review.share.copy_link"),
      onclick: async () => { const ok = await copyText(x.link); if (ok) { setH(done, "review.share.copied"); setTimeout(() => (done.innerHTML = ""), 2500); } else window.prompt(T("review.share.copy_link"), x.link); } });
    const wa = el("a", { class: "btn small", target: "_blank", rel: "noopener", href: "https://wa.me/?text=" + encodeURIComponent(x.msg),
      "aria-label": `${T("review.share.whatsapp")} — ${what}`, html: H("review.share.whatsapp") });
    const mail = el("a", { class: "btn small", href: `mailto:?subject=${encodeURIComponent(x.subject)}&body=${encodeURIComponent(x.msg)}`,
      "aria-label": `${T("review.share.email")} — ${what}`, html: H("review.share.email") });
    return el("div", { class: "rv-share" }, turn ? "" : el("span", { class: "rv-share-label", html: H("review.share.heading") }), copyBtn, wa, mail, done);
  }

  /* ---------- the list ---------- */
  let lang = null, current = null, player = null;
  const counts = {};
  const countHtml = (n) => H(n === 1 ? "review.card.comments_one" : n ? "review.card.comments" : "review.card.comments_none", { count: n, n });
  function spokenLine(r) {
    const others = (r.langs_spoken || []).filter((x) => x.lang !== r.lang && Number(x.share) >= 0.15);
    if (!others.length) return "";
    return T("review.card.languages_mixed", { lang: RZ.langName(r.lang), lang2: others.map((x) => RZ.langName(x.lang)).join(", ") });
  }
  function renderTabs() {
    const nav = $("lang-tabs");
    nav.innerHTML = "";
    nav.hidden = !RECS.length;
    if (!RECS.length) return;
    nav.setAttribute("aria-label", T("review.switcher.label"));
    const mk = (code, label, n) => el("button", { type: "button", class: "rv-tab", "aria-pressed": String(lang === code), lang: code && code !== "en" ? code : null,
      onclick: () => go({ lang: code }) }, label, el("span", { class: "n", "aria-hidden": "true" }, String(n)),
      el("span", { class: "sr-only" }, " (" + (n === 1 ? T("review.switcher.count_one") : T("review.switcher.count_line", { n })) + ")"));
    nav.append(mk(null, T("review.switcher.all"), RECS.length));
    langsPresent.forEach((l) => nav.append(mk(l, RZ.langName(l), RECS.filter((r) => r.lang === l).length)));
  }
  function card(r) {
    const n = counts[r.id];
    const cc = el("span", { class: "rv-count", "data-count": r.id });
    if (n !== undefined) cc.innerHTML = countHtml(n);
    const m = r.media || {};
    const facts = [r.partner, T("review.card.duration", { min: minutes(r.duration) }), kindText(r.kind)].filter(Boolean).join(" · ");
    const mixed = spokenLine(r);
    return el("a", { class: "card rv-card", href: "review.html?r=" + encodeURIComponent(r.id),
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go({ r: r.id }); } },
      m.poster ? el("img", { class: "rv-thumb", src: m.poster, alt: "", loading: "lazy" })
        : el("div", { class: "rv-thumb rv-thumb-" + (m.type || "x"), "aria-hidden": "true" }, el("span", {}, m.type === "mp3" ? "♪" : "▶")),
      el("div", { class: "rv-card-body" },
        el("h3", {}, recTitle(r)),
        r.title && r.title_en && r.title !== r.title_en ? el("p", { class: "rv-sub", lang: r.lang }, r.title) : "",
        el("p", { class: "rv-facts" }, facts),
        mixed ? el("p", { class: "rv-facts" }, mixed) : "",
        r.has_coaching ? el("p", { class: "rv-tag", html: H("review.card.coaching") }) : "",
        el("div", { class: "rv-card-foot", html: scoreChip(r.score) }, cc)));
  }
  function renderList() {
    const list = lang ? RECS.filter((r) => r.lang === lang) : RECS;
    const host = $("cards");
    host.innerHTML = "";
    $("list-heading").textContent = lang ? RZ.langName(lang) : T("review.switcher.all");
    if (!index) { $("list-notice").innerHTML = RZ.soon(""); return; }
    $("list-notice").innerHTML = list.length ? "" : `<p class="soon">${H("review.switcher.empty", { lang: RZ.langName(lang) })}</p>`;
    // above one language's list: the partner line for that language, why English is here, and what the score labels can and cannot say
    const notes = $("list-notes"); notes.innerHTML = "";
    if (lang && list.length) {
      const p = (k) => (has(k) ? notes.append(el("p", { class: "rv-note", html: H(k) })) : null);
      p("review.partner_notes." + lang);
      p("review.switcher.note." + lang);
      if (list.some((r) => r.source === "partner")) p("review.scores.partner_reference");
      if (list.some((r) => r.kind === "read_speech")) p("review.scores.read_sentence");
    }
    const groups = lang ? [[lang, list]] : langsPresent.map((l) => [l, list.filter((r) => r.lang === l)]);
    groups.forEach(([l, recs]) => {
      if (!recs.length) return;
      if (!lang) host.append(el("h2", { class: "rv-group" }, RZ.langName(l)), has("review.switcher.note." + l) ? el("p", { class: "rv-note", html: H("review.switcher.note." + l) }) : "");
      // partner recordings first, then public; shortest first inside each
      const sorted = recs.slice().sort((a, b) => (a.source === "public") - (b.source === "public") || (a.duration || 0) - (b.duration || 0));
      host.append(el("ul", { class: "rv-grid" }, sorted.map((r) => el("li", {}, card(r)))));
    });
  }
  async function loadCounts() {
    if (!feedback.enabled) return;
    const ids = (lang ? RECS.filter((r) => r.lang === lang) : RECS).map((r) => r.id).filter((id) => counts[id] === undefined);
    if (!ids.length) return;
    Object.assign(counts, await feedback.counts(ids));
    document.querySelectorAll("[data-count]").forEach((n) => {
      const c = counts[n.getAttribute("data-count")];
      if (c !== undefined) n.innerHTML = countHtml(c);
    });
  }

  /* ---------- one recording ---------- */
  function parseT(x) {
    if (x === null || x === undefined || x === "") return null;
    const m = String(x).match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
    const v = m ? Number(m[1]) * 60 + Number(m[2]) : Number(String(x).replace(/s$/, ""));
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  const VERDICTS = ["right", "wrong", "unsure"];

  function turnFeedback(rec, version) {
    return (tu, idx) => {
      const k = turnKey(tu, idx);
      const box = el("div", { class: "fb-turn" });
      const status = el("span", { class: "rv-status", role: "status" });
      const corr = el("textarea", { rows: "2", maxlength: "2000", lang: rec.lang, id: `corr-${idx}`, "aria-describedby": `corr-hint-${idx}`, placeholder: has("review.turn.correction_placeholder") ? RZ.t("review.turn.correction_placeholder") : "" });
      const note = el("input", { type: "text", maxlength: "2000", id: `note-${idx}`, placeholder: has("review.turn.note_placeholder") ? RZ.t("review.turn.note_placeholder") : "" });
      const send = el("button", { type: "submit", class: "btn small primary", html: H("review.turn.submit"), disabled: !feedback.enabled });
      const form = el("form", { class: "fb-form", hidden: true, novalidate: true },
        el("label", { for: `corr-${idx}`, html: H("review.turn.correction_label") }), corr,
        el("p", { class: "rv-hint", id: `corr-hint-${idx}`, html: H("review.correction_hint") }),
        el("label", { for: `note-${idx}`, html: H("review.turn.note_label") }), note,
        el("div", { class: "rv-actions" }, send));
      let verdict = null;
      const btns = VERDICTS.map((v) => el("button", { type: "button", class: `btn small fb-v fb-${v}`, "aria-pressed": "false", disabled: !feedback.enabled,
        "aria-label": `${T("review.turn." + v)} — ${RZ.fmt(tu.start)}`, html: H("review.turn." + v),
        onclick: () => {
          const off = verdict === v;
          pick(off ? null : v);
          form.hidden = off;
          if (!off) (v === "right" ? send : corr).focus();
        } }));
      function pick(v) { verdict = v; btns.forEach((b, j) => b.setAttribute("aria-pressed", String(VERDICTS[j] === v))); }
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!verdict) return;
        const r = await submit({ turn_i: k, t: tu.start, turn_text: String(tu.text || "").slice(0, 2000) || undefined, transcript_version: version, verdict, correction: corr.value.trim() || undefined, note: note.value.trim() || undefined }, status, send, "review.turn.saved");
        if (r) { form.hidden = true; corr.value = ""; note.value = ""; }
      });
      const shareBtn = el("button", { type: "button", class: "btn small fb-share", "aria-expanded": "false", html: H("review.turn.share") });
      const sharePanel = shareRow(rec, Object.assign({ idx }, tu));
      sharePanel.hidden = true;
      shareBtn.addEventListener("click", () => { sharePanel.hidden = !sharePanel.hidden; shareBtn.setAttribute("aria-expanded", String(!sharePanel.hidden)); });
      const split = tu.agree !== null && tu.agree !== undefined && Number(tu.agree) < 0.5 && has("review.turn.split_hint");
      box.append(split ? el("p", { class: "rv-split", html: H("review.turn.split_hint") }) : "", el("div", { class: "fb-row" }, ...btns, shareBtn), status, form, sharePanel);
      return box;
    };
  }

  function playFrom(t, turnI) {
    if (!player) return;
    const idx = turnI === null || turnI === undefined ? -1 : player.turns.findIndex((x, j) => turnKey(x, j) === Number(turnI));
    if (idx >= 0) player.highlight(idx);
    $("player-host").scrollIntoView({ block: "start", behavior: "smooth" });
    player.seek(Math.max(0, Number(t) || 0), true);
  }

  function commentItem(c) {
    const when = c.received_at ? new Date(c.received_at) : null;
    const whenTxt = when && !isNaN(when) ? when.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    const turnI = c.turn_i === null || c.turn_i === undefined || c.turn_i === "" ? null : Number(c.turn_i);
    const tu = turnI !== null && player ? player.turns.find((x, j) => turnKey(x, j) === turnI) : null;
    const t = c.t !== null && c.t !== undefined && c.t !== "" && Number.isFinite(Number(c.t)) ? Number(c.t) : tu ? tu.start : null;
    const head = el("div", { class: "c-head" }, el("strong", {}, String(c.name || "")), c.role ? el("span", { class: "c-role" }, String(c.role)) : "",
      whenTxt ? el("time", { datetime: String(c.received_at) }, whenTxt) : "");
    const bits = el("div", { class: "c-bits" });
    if (t !== null) bits.append(el("button", { type: "button", class: "ts", "aria-label": `${T("review.comment.go_to_line")} ${RZ.fmt(t)}`, onclick: () => playFrom(t, turnI) }, "▶ " + RZ.fmt(t)));
    if (VERDICTS.includes(c.verdict)) bits.append(el("span", { class: `c-verdict fb-${c.verdict}`, html: H("review.comment.verdict." + c.verdict) }));
    const li = el("li", { class: "c-item" + (c.pending ? " pending" : "") }, head, bits.childNodes.length ? bits : "");
    if (c.correction) li.append(el("p", { class: "c-corr" }, el("span", { class: "c-lab", html: H("review.comment.correction_prefix") }), " ", el("span", { lang: current ? current.lang : null }, String(c.correction))));
    if (c.note) li.append(el("p", { class: "c-note" }, el("span", { class: "c-lab", html: H("review.comment.note_prefix") }), " ", String(c.note)));
    if (c.comment) li.append(el("p", { class: "c-comment" }, String(c.comment)));
    return li;
  }
  function addComment(c, top) {
    const host = $("comments");
    host.querySelectorAll("li.empty").forEach((n) => n.remove());
    const li = commentItem(c);
    top ? host.prepend(li) : host.append(li);
  }
  async function loadComments(id) {
    const host = $("comments");
    host.innerHTML = "";
    if (!feedback.enabled) { host.append(el("li", { class: "note empty", html: H("review.status.closed") })); return; }
    const rows = await feedback.list(id);
    if (!current || current.id !== id) return;
    host.innerHTML = "";
    if (rows === null) { host.append(el("li", { class: "note empty", html: H("review.status.error") })); return; }
    counts[id] = rows.length;
    if (!rows.length) { host.append(el("li", { class: "note empty", html: H("review.comment.empty") })); return; }
    rows.forEach((c) => addComment(c, false));
  }

  async function openRec(id, o) {
    o = o || {};
    const rec = byId[id];
    current = rec; player = null;
    $("list").hidden = true; $("intro").hidden = true; $("lang-tabs").hidden = true;
    const sec = $("rec");
    sec.hidden = false;
    setH($("back"), "review.player.back_to_list");
    $("back").href = "review.html?lang=" + encodeURIComponent(rec.lang);
    $("back").onclick = (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go({ lang: rec.lang }); };
    $("rec-title").textContent = recTitle(rec);
    document.title = recTitle(rec) + " — " + baseTitle();
    const meta = $("rec-meta");
    meta.innerHTML = "";
    meta.append(el("span", {}, RZ.langName(rec.lang)), rec.partner ? el("span", {}, rec.partner) : "",
      el("span", {}, T("review.card.duration", { min: minutes(rec.duration) })), rec.kind ? el("span", {}, kindText(rec.kind)) : "",
      rec.source ? el("span", { html: H("review.card.source." + rec.source) }) : "", spokenLine(rec) ? el("span", {}, spokenLine(rec)) : "");
    $("rec-share").innerHTML = ""; $("rec-share").append(shareRow(rec, null));
    $("player-host").innerHTML = "";

    const stt = await RZ.load(`data/review/${encodeURIComponent(id)}.json`);
    if (current !== rec) return;
    const turns = ((stt && stt.turns) || []).slice().sort((a, b) => a.start - b.start);
    let t = o.t, idx = null;
    if (o.turn !== null && o.turn !== undefined) {
      const j = turns.findIndex((x, n) => turnKey(x, n) === Number(o.turn));
      if (j >= 0) { idx = j; if (t === null || t === undefined) t = turns[j].start; }
    } else if (t !== null && t !== undefined) {
      // the line playing at t; a shared link floors seconds, so a line starting within 1 s after t is the one meant
      const at = turns.findIndex((x) => x.start <= t + 0.05 && (x.end === undefined || x.end === null || t < x.end));
      const soon = turns.findIndex((x) => x.start > t && x.start < t + 1);
      if (soon >= 0 && (at < 0 || turns[at].start < t - 0.05)) idx = soon;
      else if (at >= 0) idx = at;
      else for (let j = 0; j < turns.length; j++) if (turns[j].start <= t + 0.05) idx = j;
    }
    if (t === undefined) t = null;
    const banner = $("banner");
    if (o.fromLink) {
      banner.innerHTML = "";
      banner.append(el("span", { html: H(t !== null ? "review.banner.deeplink_turn" : "review.banner.deeplink", { time: t !== null ? RZ.fmt(t) : "" }) }),
        el("button", { type: "button", class: "btn small rv-x", html: H("review.banner.dismiss"), onclick: () => (banner.hidden = true) }));
      banner.hidden = false;
    } else banner.hidden = true;

    const m = rec.media || {};
    if (!m.src && !m.youtube_id) $("player-host").innerHTML = RZ.soon("");
    else {
      const data = Object.assign({ lang: rec.lang, title: recTitle(rec) }, stt || {}, { turns, media: m });
      if (m.type === "youtube") data.video = { youtube_id: m.youtube_id, start: m.start || 0, end: m.end, title: rec.title, channel: rec.partner, url: `https://www.youtube.com/watch?v=${m.youtube_id}` };
      const credit = m.type === "youtube" ? undefined : [rec.title, rec.partner].filter(Boolean).join(" · ");
      player = new SyncPlayer($("player-host"), data, { key: rec.id, startAt: t, credit,
        english: has("review.player.english_toggle") ? RZ.t("review.player.english_toggle") : undefined, turnExtra: turns.length ? turnFeedback(rec, stt && (stt.turns_version != null ? stt.turns_version : stt.version != null ? stt.version : undefined)) : null });
      SyncPlayer.byLang[rec.lang] = player;   // the coaching report's timestamps play this recording
      $("player-host").querySelector(".sync").classList.add("rv-sync");
      if (!turns.length) $("player-host").append(el("p", { class: "soon rv-soon", html: H("review.player.no_transcript") }));
      if (idx !== null) { const p = player; requestAnimationFrame(() => p.highlight(idx)); }
    }
    // this recording's numbers: agreement is a proxy; a measured CER appears only where a verbatim same-language reference exists
    const sc = $("rec-scores"), parts = [];
    const line = (s) => {
      const x = RZ.score(s), cls = kindOf(x.label), mean = chipMeaning(cls);
      const txt = String(x.line || "").replace(SILENCE_RE, "").trim();
      return `<div class="score-line">${scoreChip(s)} <span class="note">${mean ? `<span class="rv-mean">${RZ.esc(mean)}</span> ` : ""}${RZ.esc(txt)}</span></div>`;
    };
    const main = (stt && stt.score) || rec.score;
    if (main) parts.push(line(main));
    if (stt && stt.agreement && JSON.stringify(stt.agreement) !== JSON.stringify(main)) parts.push(line(stt.agreement));
    if (stt && stt.meaning) parts.push(line(stt.meaning));
    const silent = Math.max(0, ...[main, stt && stt.agreement].map((x) => Number(x && x.removed_in_silence) || 0));
    if (silent) parts.push(`<p class="note rv-silence">${RZ.esc(silenceLine(silent))}</p>`);
    if (stt && stt.reference && stt.reference.line) parts.push(`<p class="note">${RZ.esc(stt.reference.line)}</p>`);
    if (stt && (stt.sources || []).length) parts.push(`<p class="note">${RZ.esc(RZ.ui("sources_label", "Sources"))} ${RZ.cite(stt.sources)}</p>`);
    sc.innerHTML = parts.join("");

    $("comment-label").innerHTML = H("review.comment.heading");
    $("comment-text").placeholder = has("review.comment.placeholder") ? RZ.t("review.comment.placeholder") : "";
    $("comment-text").disabled = !feedback.enabled; $("comment-send").disabled = !feedback.enabled;
    setH($("comment-send"), "review.comment.submit");
    $("comment-status").innerHTML = "";
    loadComments(rec.id);

    const cw = $("coach-wrap"); cw.hidden = true; $("coach-host").innerHTML = "";
    if (rec.has_coaching) {
      const coach = await RZ.load(`data/review/${encodeURIComponent(id)}.coach.json`);
      if (coach && current === rec) {
        if (coach.voice) coach.voice.words = await RZ.words(coach.voice.words);
        window.Report.mount($("coach-host"), coach, rec.lang, {});
        cw.hidden = false;
      }
    }
    footnotes();
    if (o.fromLink) { banner.scrollIntoView({ block: "start" }); sec.focus({ preventScroll: true }); }
    else window.scrollTo(0, 0);
  }
  $("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const txt = $("comment-text").value.trim();
    if (!txt || !current) { $("comment-text").focus(); return; }
    const r = await submit({ comment: txt }, $("comment-status"), $("comment-send"), "review.status.thanks");
    if (r) $("comment-text").value = "";
  });

  function footnotes() {
    const any = document.querySelector("sup.fn");
    $("sources").hidden = !any;
    if (any) RZ.renderFootnotes($("fn-host"));
  }

  /* ---------- routing ---------- */
  function showList() {
    current = null; player = null;
    $("rec").hidden = true; $("list").hidden = false; $("intro").hidden = false;
    $("player-host").innerHTML = "";
    document.title = baseTitle();
    renderTabs(); renderList(); loadCounts(); footnotes();
  }
  /** A link to an id that is not (or no longer) in index.json: say so, and point at that language's list (the id starts with its code). */
  const idLang = (id) => { const c = String(id).split("-")[0]; return langsPresent.includes(c) ? c : null; };
  function notFound(id) {
    const c = idLang(id);
    const raw = has("review.player.not_found") ? RZ.raw("review.player.not_found") : null;
    if (!raw) return H("review.player.no_transcript");
    return RZ.inline(c ? String(raw).replace(/\(review\.html\)/g, "(review.html?lang=" + c + ")") : String(raw));
  }
  function route(fromLink) {
    const q = new URLSearchParams(location.search);
    const r = q.get("r"), l = q.get("lang");
    lang = l && langsPresent.includes(l) ? l : null;
    if (r && !byId[r] && !lang) lang = idLang(r);
    if (r && byId[r]) {
      const turn = q.get("turn");
      return openRec(r, { t: parseT(q.get("t")), turn: turn !== null && /^\d+$/.test(turn) ? Number(turn) : null, fromLink });
    }
    showList();
    if (l && !lang && index) $("list-notice").innerHTML = `<p class="soon">${H("review.switcher.empty", { lang: RZ.langName(l) })}</p>`;
    if (r) $("list-notice").innerHTML = index ? `<p class="soon" role="alert">${notFound(r)}</p>` : RZ.soon("");
  }
  function go(p) {
    const q = new URLSearchParams();
    if (p.r) q.set("r", p.r); else if (p.lang) q.set("lang", p.lang);
    history.pushState(null, "", "review.html" + (q.toString() ? "?" + q : ""));
    route(false);
  }
  window.addEventListener("popstate", () => route(false));
  route(true);
})();
