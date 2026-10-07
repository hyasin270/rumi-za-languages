/* core.js — shared helpers for every page.
 *
 * RZ.load(path)        fetch a JSON data file; resolves null if it is not there yet (so pages degrade to "coming shortly").
 * RZ.boot({lang})      loads copy.json + footnotes.json once; call before rendering.
 * RZ.t(key)            copy text (plain) for a key; language pages look up "<lang>.<key>" then "lang.<key>".
 * RZ.html(key)         copy rendered with inline markup: **bold**, [text](url), [[fn:id]] (or [^id]) footnote markers.
 *                      A missing key renders a visible placeholder "[copy: key]".
 * RZ.ui(key, fallback) interface labels (buttons, legends); copy.json "ui.<key>" overrides the fallback.
 * RZ.cite(ids)         footnote markers for source ids; numbered per page in order of first use.
 * RZ.renderFootnotes(el)  the page's numbered list, each with back-links to every marker.
 * RZ.chip(score, opts) ScoreChip: value + label; never rounds up (truncates to 1 decimal, or whole % for shares).
 * RZ.el(tag, attrs, ...children)  tiny DOM builder.
 */
(function () {
  const RZ = (window.RZ = {});
  let COPY = {}, FN = [], LANG = null;
  const fnOrder = [], fnRefs = {};

  RZ.load = async function (path) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  };

  RZ.boot = async function (opts) {
    LANG = (opts && opts.lang) || null;
    const [c, f] = await Promise.all([RZ.load("data/copy.json"), RZ.load("data/footnotes.json")]);
    COPY = c || {};
    FN = Array.isArray(f) ? f : (f && f.footnotes) || [];
    RZ.copyLoaded = !!c;
  };

  // copy.json may be flat ("zu.listening.lead"), nested, or mixed ("zu.listening": {"lead": …}); accept any mix.
  function get(obj, key) {
    const parts = Array.isArray(key) ? key : key.split(".");
    if (!parts.length) return obj;
    if (!obj || typeof obj !== "object") return undefined;
    for (let i = parts.length; i >= 1; i--) {
      const k = parts.slice(0, i).join(".");
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        const v = get(obj[k], parts.slice(i));
        if (v !== undefined) return v;
      }
    }
    return undefined;
  }
  RZ.raw = function (key) {
    if (LANG) {
      const v = get(COPY, LANG + "." + key);
      if (v !== undefined) return v;
      const s = get(COPY, "lang." + key);
      if (v === undefined && s !== undefined) return typeof s === "string" ? s.replace(/\{lang\}/g, RZ.langName(LANG)) : s;
    }
    return get(COPY, key);
  };
  RZ.has = (key) => { const v = RZ.raw(key); return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length); };
  RZ.t = function (key) {
    const v = RZ.raw(key);
    return typeof v === "string" ? v.replace(/\s*\[\[fn:[^\]]+\]\]/g, "").replace(/\[\^[^\]]+\]/g, "").replace(/\*\*/g, "") : "";
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  RZ.esc = esc;

  RZ.inline = function (s) {
    let h = esc(s);
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|[a-z]{2}\.html[^)\s]*|#[^)\s]+|index\.html[^)\s]*)\)/g, (m, t, u) => {
      const ext = /^https?:/.test(u);
      return `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ""}>${t}</a>`;
    });
    h = h.replace(/\[\[fn:([^\]]+)\]\]/g, (m, id) => RZ.cite([id.trim()]));
    h = h.replace(/\[\^([^\]]+)\]/g, (m, id) => RZ.cite([id]));
    return h;
  };
  RZ.placeholder = (key) => `<span class="ph" title="copy pending">[copy: ${esc(key)}]</span>`;
  RZ.html = function (key) {
    const v = RZ.raw(key);
    if (!RZ.has(key)) return RZ.placeholder(key);
    if (Array.isArray(v)) return v.map((x) => RZ.inline(typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    return RZ.inline(typeof v === "string" ? v : String(v));
  };
  /** Paragraph(s): a string → <p>, an array → bullet list. */
  RZ.block = function (key, cls) {
    const v = RZ.raw(key);
    if (v === undefined || v === "") return `<p class="${cls || ""}">${RZ.placeholder(key)}</p>`;
    if (Array.isArray(v)) return `<ul class="bullets ${cls || ""}">${v.map((x) => `<li>${RZ.inline(x)}</li>`).join("")}</ul>`;
    return String(v).split(/\n\n+/).map((p) => `<p class="${cls || ""}">${RZ.inline(p)}</p>`).join("");
  };
  RZ.ui = function (key, fallback) {
    const v = get(COPY, "ui." + key);
    return typeof v === "string" && v ? v : fallback;
  };

  /* ---------- footnotes ---------- */
  RZ.footnote = (id) => FN.find((f) => f.id === id);
  RZ.cite = function (ids) {
    if (!ids) return "";
    if (!Array.isArray(ids)) ids = [ids];
    return ids.filter(Boolean).map((id) => {
      if (!fnOrder.includes(id)) fnOrder.push(id);
      const n = fnOrder.indexOf(id) + 1;
      fnRefs[id] = (fnRefs[id] || 0) + 1;
      const k = fnRefs[id];
      const f = RZ.footnote(id);
      const label = f ? f.label : id;
      return `<sup class="fn"><a href="#fn-${esc(id)}" id="ref-${esc(id)}-${k}" aria-label="Source ${n}: ${esc(label)}">[${n}]</a></sup>`;
    }).join("");
  };
  RZ.renderFootnotes = function (host) {
    if (!host) return;
    // Renumber by FIRST APPEARANCE in the document (async panels render out of reading order).
    const markers = [...document.querySelectorAll("sup.fn a[href^='#fn-']")];
    fnOrder.length = 0; for (const k in fnRefs) delete fnRefs[k];
    markers.forEach((a) => {
      const id = decodeURIComponent(a.getAttribute("href").slice(4));
      if (!fnOrder.includes(id)) fnOrder.push(id);
      fnRefs[id] = (fnRefs[id] || 0) + 1;
      const n = fnOrder.indexOf(id) + 1, f = RZ.footnote(id);
      a.textContent = `[${n}]`;
      a.id = `ref-${id}-${fnRefs[id]}`;
      a.setAttribute("aria-label", `Source ${n}: ${f ? f.label : id}`);
    });
    if (!fnOrder.length) { host.innerHTML = `<p class="note">${esc(RZ.ui("no_sources", "No sources cited on this page yet."))}</p>`; return; }
    host.innerHTML = `<ol class="footnotes">${fnOrder.map((id) => {
      const f = RZ.footnote(id);
      const backs = Array.from({ length: fnRefs[id] || 1 }, (_, i) =>
        `<a class="back" href="#ref-${esc(id)}-${i + 1}" aria-label="Back to reference ${i + 1}">↩${fnRefs[id] > 1 ? `<sup>${i + 1}</sup>` : ""}</a>`).join("");
      if (!f) return `<li id="fn-${esc(id)}">${RZ.placeholder("footnote " + id)} ${backs}</li>`;
      const bits = [f.publisher, f.year].filter(Boolean).map(esc).join(", ");
      const title = f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label)}</a>` : esc(f.label);
      return `<li id="fn-${esc(id)}">${title}${bits ? ". " + bits : ""}.${f.licence ? ` <span class="lic">${esc(f.licence)}.</span>` : ""} ${backs}</li>`;
    }).join("")}</ol>`;
  };

  /* ---------- ScoreChip ---------- */
  /** Normalise a score from any lane's shape: number | "9.2" | {value, display, label, line, note}. */
  RZ.score = function (x) {
    if (x === null || x === undefined) return { value: null };
    if (typeof x !== "object") return { value: x };
    return x;
  };
  /** Label text → [short label, css class]. "measured (automated) · native ear pending" → measured. */
  RZ.labelOf = function (label) {
    const k = String(label || "").toLowerCase();
    if (!k) return ["", ""];
    if (k.includes("not run")) return [RZ.ui("label_not_run", "not run"), "pending"];
    if (k.includes("ai") || k.includes("proxy")) return [RZ.ui("label_ai", "AI-judged"), "ai"];
    if (k.includes("measured")) return [RZ.ui("label_measured", "measured"), "measured"];
    if (k.includes("pending")) return [RZ.ui("label_pending", "native ear pending"), "pending"];
    return [label, "measured"];
  };
  /** Truncate, never round up. */
  RZ.trunc = function (v, dp) {
    const f = Math.pow(10, dp);
    return (Math.floor(Number(v) * f + 1e-9) / f).toFixed(dp);
  };
  /**
   * RZ.chip(score, {kind:"10"|"pct"|"raw", key, href, noLabel})
   *   score: number | string | {value, display, label}. A short numeric `display` from the data owner wins
   *   (they truncated it); otherwise value is truncated to 1 decimal (/10) or whole % (kind "pct").
   *   A missing or non-numeric value renders as a muted chip ("pending", "not run", or the owner's display text).
   */
  RZ.chip = function (score, opts) {
    opts = opts || {};
    const sc = RZ.score(score);
    const [lab, cls] = RZ.labelOf(sc.label);
    const v = sc.value, n = Number(v);
    const disp = sc.display !== undefined && sc.display !== null ? String(sc.display) : "";
    const kind = opts.kind || "10";
    if (v === null || v === undefined || v === "" || Number.isNaN(n)) {
      const txt = /^[A-Z]{3,}$/.test(String(v || "")) ? String(v) : (disp && disp.length < 24 ? disp : (cls === "pending" && lab ? "" : RZ.ui("pending", "pending")));
      return wrap(txt ? `<span class="v">${esc(txt)}</span>` : "", /^[A-Z]{3,}$/.test(String(v || "")) ? "verdict " + String(v).toLowerCase() : "pending", opts, lab);
    }
    let vs, of = "";
    if (kind === "pct") vs = RZ.trunc(n * 100, 0) + "%";
    else if (kind === "pct-up") vs = (Math.ceil(n * 1000 - 1e-9) / 10).toFixed(1) + "%"; // an error/disagreement rate: round UP
    else if (kind === "raw") vs = String(v);
    else if (/^\d+(\.\d)?$/.test(disp)) { vs = disp; of = "/10"; }
    else { vs = RZ.trunc(n, 1); of = "/10"; }
    return wrap(`<span class="v">${vs}</span>${of ? `<span class="of">${of}</span>` : ""}`, cls, opts, lab);
  };
  function wrap(inner, cls, opts, lab) {
    const key = opts.key ? `<span class="k">${esc(opts.key)}</span>` : "";
    const l = lab && !opts.noLabel ? `<span class="l">${esc(lab)}</span>` : "";
    const aria = esc([opts.key, inner.replace(/<[^>]+>/g, ""), lab].filter(Boolean).join(" "));
    if (opts.href) return `<a class="chip ${cls}" href="${esc(opts.href)}" aria-label="${aria}">${key}${inner}${l}</a>`;
    return `<span class="chip ${cls}" aria-label="${aria}">${key}${inner}${l}</span>`;
  }

  /* ---------- misc ---------- */
  RZ.fmt = function (t) {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ":" + String(s).padStart(2, "0");
  };
  RZ.LANGS = { zu: "isiZulu", xh: "isiXhosa", st: "Sesotho", nso: "Sepedi", af: "Afrikaans", tn: "Setswana" };
  RZ.langName = (c) => RZ.LANGS[c] || c;
  RZ.soon = (what) => `<div class="soon" role="status">${esc(RZ.ui("coming_shortly", "Coming shortly"))}${what ? ` — ${esc(what)}` : ""}</div>`;
  RZ.el = function (tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  };

  /** A word-timing list may be inline [{w,s,e}] or a path to a JSON file holding one. */
  RZ.words = async function (x) {
    if (Array.isArray(x)) return x;
    if (typeof x === "string" && x) { const w = await RZ.load(x); return Array.isArray(w) ? w : (w && w.words) || []; }
    return [];
  };

  /* ---------- TOC (sticky sidebar on desktop, collapsible on phone) ---------- */
  RZ.buildToc = function () {
    const items = [...document.querySelectorAll("main [data-toc]")].map((s) => ({
      id: s.id, label: s.getAttribute("data-toc-label") || (s.querySelector("h2,h3") || {}).textContent || s.id, sub: s.hasAttribute("data-toc-sub"),
    }));
    const list = () => `<ol>${items.map((i) => `<li class="${i.sub ? "sub" : ""}"><a href="#${i.id}" data-id="${i.id}">${esc(i.label)}</a></li>`).join("")}</ol>`;
    const title = esc(RZ.t("index.toc.heading") || RZ.ui("toc", "On this page"));
    const d = document.getElementById("toc-desktop"), m = document.getElementById("toc-mobile");
    if (d) d.innerHTML = `<p class="toc-title">${title}</p><nav class="toc" aria-label="${title}">${list()}</nav>`;
    if (m) {
      m.innerHTML = `<summary>${esc(RZ.t("index.toc.toggle") || RZ.t("index.toc.heading") || "On this page")}</summary><nav class="toc" aria-label="${title} (compact)">${list()}</nav>`;
      m.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => m.removeAttribute("open")));
    }
    const links = document.querySelectorAll(".toc a");
    const obs = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("active", a.dataset.id === e.target.id));
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    items.forEach((i) => { const s = document.getElementById(i.id); if (s) obs.observe(s); });
  };

  /** Fill every [data-copy] / [data-copy-block] element from copy.json. */
  RZ.fillCopy = function (root) {
    (root || document).querySelectorAll("[data-copy]").forEach((n) => {
      const k = n.getAttribute("data-copy");
      // optional lines (notes, captions) stay empty and hidden when there is no copy for them
      if (!RZ.has(k) && n.matches(".note, .vmaterial, .pending-ear, .site-footer *")) { n.textContent = ""; n.hidden = true; return; }
      n.innerHTML = RZ.html(k);
    });
    (root || document).querySelectorAll("[data-copy-block]").forEach((n) => { n.innerHTML = RZ.block(n.getAttribute("data-copy-block")); });
    (root || document).querySelectorAll("[data-toc]").forEach((s) => {
      const h = s.querySelector("h2,h3");
      if (h && !s.getAttribute("data-toc-label")) s.setAttribute("data-toc-label", h.textContent.replace(/\[\d+\]/g, "").trim());
    });
  };

  /** Arrive at a #hash after async rendering has changed the page height. */
  RZ.settleHash = function () {
    if (!location.hash) return;
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) setTimeout(() => t.scrollIntoView({ block: "start" }), 50);
  };
})();
