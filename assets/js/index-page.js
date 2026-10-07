/* index-page.js — renders index.html from data/summary.json, data/scheme.json and data/copy.json ("index.*").
 * summary.json (ED): { governing_thought, conditions:[…], legend:{measured, "AI-judged", "native ear pending", verdict},
 *   columns:[{key,title}], rows:[{code,name,page,cells:{Q1..Q4:{value,label,href,note?}, verdict:{value,label,href}}}],
 *   also_tested:{title, href, rows:[same shape]} }
 * copy.json "index.*": meta, answer, method (diagram_lp / diagram_coach = step lists), languages.cards.<c>.{name,line,cta},
 *   also_tested.lines.<c>, scheme, ship.{columns,rows}, partners, cost.{columns,rows,note}, sources, footer.
 */
(async function () {
  const RZ = window.RZ, $ = (id) => document.getElementById(id), esc = RZ.esc;
  await RZ.boot({});
  RZ.fillCopy();
  document.querySelectorAll("p.note[data-copy], span[data-copy]").forEach((n) => { if (!RZ.has(n.getAttribute("data-copy"))) n.hidden = true; });
  const [summary, scheme] = await Promise.all([RZ.load("data/summary.json"), RZ.load("data/scheme.json")]);

  const cols = (summary && summary.columns) || [{ key: "Q1", title: "Lesson plans" }, { key: "Q2", title: "Listening" }, { key: "Q3", title: "Coaching" }, { key: "Q4", title: "Speaking" }, { key: "verdict", title: "Verdict" }];
  const qcols = cols.filter((c) => c.key !== "verdict");
  const vcol = cols.find((c) => c.key === "verdict") || { key: "verdict", title: "Verdict" };

  /* 1. conditions + summary table */
  $("conditions").innerHTML = ((summary && summary.conditions) || []).map((c) => `<li>${RZ.inline(c)}</li>`).join("");
  const scoreCell = (r, c) => {
    const x = r.cells && r.cells[c.key];
    return `<td data-h="${esc(c.title)}">${RZ.chip(x, { href: x && x.href })}${x && x.note ? `<span class="cell-note">${esc(x.note)}</span>` : ""}</td>`;
  };
  const verdictCell = (r) => {
    const v = r.cells && r.cells.verdict;
    return `<td data-h="${esc(vcol.title)}">${v ? RZ.chip(v, { href: v.href, noLabel: true }) + (v.label ? `<span class="cell-note">${esc(v.label)}</span>` : "") : ""}</td>`;
  };
  const nameCell = (r) => {
    const n = esc(r.name || RZ.langName(r.code));
    return `<th scope="row">${r.page ? `<a href="${esc(r.page)}">${n}</a>` : n}</th>`;
  };
  const rowHtml = (r, cls) => `<tr class="${cls || ""}">${nameCell(r)}${qcols.map((c) => scoreCell(r, c)).join("")}${verdictCell(r)}</tr>`;
  const head = `<thead><tr><th scope="col">${esc(RZ.ui("col_language", "Language"))}</th>${cols.map((c) => `<th scope="col">${esc(c.title)}</th>`).join("")}</tr></thead>`;
  const also = summary && summary.also_tested;
  if (summary && (summary.rows || []).length) {
    const alsoRows = also && (also.rows || []).length
      ? `<tr class="group"><th colspan="${cols.length + 1}" scope="rowgroup"><a href="#also-tested">${esc(also.title || "Also tested")}</a></th></tr>` + also.rows.map((r) => rowHtml(r, "also")).join("")
      : "";
    $("summary-table").innerHTML = `<table class="summary"><caption class="sr-only">${esc(RZ.t("index.answer.table_heading") || "Scores by language")}</caption>${head}<tbody>${summary.rows.map((r) => rowHtml(r)).join("")}${alsoRows}</tbody></table>`;
  } else $("summary-table").innerHTML = RZ.soon(RZ.ui("soon_summary", "the summary table"));

  /* 3. method: two pipeline diagrams + the label key */
  const pipe = (titleKey, fallbackTitle, steps) => Array.isArray(steps) && steps.length
    ? `<div class="card"><p class="subcard-title">${esc(RZ.t(titleKey) || fallbackTitle)}</p><ol class="pipeline">${steps.map((s, i) =>
        `<li><span class="n">${i + 1}</span>${RZ.inline(typeof s === "string" ? s : `${s.name || ""}${s.desc ? " — " + s.desc : ""}`)}</li>`).join("")}</ol></div>` : "";
  const p1 = pipe("index.method.diagram_lp_title", "Curriculum page → lesson plan", RZ.raw("index.method.diagram_lp"));
  const p2 = pipe("index.method.diagram_coach_title", "Classroom recording → coaching report", RZ.raw("index.method.diagram_coach"));
  $("pipelines").innerHTML = p1 + p2 || `<div class="card">${RZ.placeholder("index.method.diagram_lp")}</div>`;
  const leg = (summary && summary.legend) || {};
  const keyRows = [["measured", "measured"], ["AI-judged", "ai"], ["native ear pending", "pending"], ["verdict", "verdict"]];
  $("labels-key").innerHTML = keyRows.filter(([k]) => leg[k]).map(([k, cls]) =>
    `<div class="card"><span class="chip ${cls}" style="justify-self:start"><span class="l">${esc(k === "verdict" ? vcol.title : RZ.labelOf(k)[0])}</span></span><span class="note">${RZ.inline(leg[k])}</span></div>`).join("");
  if (RZ.has("index.method.verdict_rule") && !leg.verdict) $("labels-key").insertAdjacentHTML("beforeend", `<div class="card"><span class="note">${RZ.html("index.method.verdict_rule")}</span></div>`);

  /* 4. language cards */
  $("lang-cards").innerHTML = ["zu", "xh", "st"].map((c) => {
    const r = summary && (summary.rows || []).find((x) => (x.code || x.lang) === c);
    const chips = qcols.map((q) => RZ.chip(r && r.cells ? r.cells[q.key] : null, { key: q.title, noLabel: true })).join(" ");
    const strip = (h) => h.replace(/<\/?a[^>]*>/g, "");
    return `<a class="card lang-card" href="${c}.html"><h3 lang="${c}">${esc(RZ.t(`index.languages.cards.${c}.name`) || RZ.langName(c))}</h3>
      <p style="margin:0">${strip(RZ.html(`index.languages.cards.${c}.line`))}</p><div class="chip-row">${chips}</div>
      <span class="go">${esc(RZ.t(`index.languages.cards.${c}.cta`) || "Open")} →</span></a>`;
  }).join("");

  /* 4b. also tested */
  if (also && (also.rows || []).length) {
    $("also-table").innerHTML = `<table class="summary">${head}<tbody>${also.rows.map((r) => rowHtml(r)).join("")}</tbody></table>` +
      `<ul class="bullets" style="margin-top:14px">${also.rows.map((r) => RZ.has(`index.also_tested.lines.${r.code}`) ? `<li>${RZ.html(`index.also_tested.lines.${r.code}`)}</li>` : "").join("")}</ul>`;
  } else $("also-table").innerHTML = RZ.soon(RZ.ui("soon_also", "the other three languages"));
  // one spoken sample per also-tested language (data/more/<code>_tts.json, same shape as tts.json)
  if (window.Karaoke && also && (also.rows || []).length) {
    const grid = RZ.el("div", { class: "grid-3", style: "margin-top:16px" });
    for (const r of also.rows) {
      const t = await RZ.load(`data/more/${r.code}_tts.json`);
      const m = t && (t.conversation || []).find((x) => x.from === "rumi" && x.mp3);
      if (!m) continue;
      m.words = await RZ.words(m.words);
      const card = RZ.el("div", { class: "card" }, RZ.el("p", { class: "subcard-title" }, `${r.name || RZ.langName(r.code)} · ${RZ.ui("hear_rumi", "Rumi speaking")}`));
      Karaoke.mount(card, { mp3: m.mp3, words: m.words, text: m.text, en: m.en, lang: r.code, label: `${r.name} voice note`, compact: true });
      const sc = RZ.score(t.score);
      if (sc.value !== null && sc.value !== undefined) card.insertAdjacentHTML("beforeend", `<div class="score-line">${RZ.chip(sc, { key: (cols.find((c) => c.key === "Q4") || {}).title || "Speaking" })}</div>`);
      grid.append(card);
    }
    if (grid.children.length) $("also-table").after(grid);
  }

  /* 5. scheme of studies */
  if (scheme) {
    const alt = RZ.t("index.scheme.screenshot_alt") || "Screenshot of the scheme of studies";
    const shot = scheme.screenshot ? `<a href="${esc(scheme.sheet_url)}" target="_blank" rel="noopener"><img src="${esc(scheme.screenshot)}" alt="${esc(alt)}" style="border:1px solid var(--line);border-radius:10px;display:block"></a>` : "";
    const facts = [scheme.book, scheme.language, scheme.weeks ? `${scheme.weeks} ${RZ.ui("weeks", "weeks")}` : "", scheme.rows ? `${scheme.rows} ${RZ.ui("rows", "rows")}` : ""].filter(Boolean).map(esc).join(" · ");
    $("scheme-host").innerHTML = `<div class="card">${shot}<p class="note" style="margin:10px 0">${facts}${RZ.cite(scheme.sources)}</p>${
      `<div class="chip-row">${scheme.sheet_url ? `<a class="btn primary" href="${esc(scheme.sheet_url)}" target="_blank" rel="noopener">${esc(RZ.t("index.scheme.cta") || "Open the full sheet")} ↗</a>` : ""}${
      (scheme.tabs || []).map((t) => `<a class="btn small" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.label)} ↗</a>`).join("")}</div>`}</div>`;
  } else $("scheme-host").innerHTML = RZ.soon(RZ.ui("soon_scheme", "the scheme-of-studies sheet"));

  /* 6. ship + cost tables (rows are arrays matching columns) */
  const table = (colsKey, rowsKey) => {
    const cs = RZ.raw(colsKey), rs = RZ.raw(rowsKey);
    if (!Array.isArray(rs) || !rs.length) return `<div class="card">${RZ.placeholder(rowsKey)}</div>`;
    const cells = (r) => (Array.isArray(r) ? r : Object.values(r));
    return `<table class="plain">${Array.isArray(cs) ? `<thead><tr>${cs.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${
      rs.map((r) => `<tr>${cells(r).map((x) => `<td>${RZ.inline(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  $("ship-table").innerHTML = table("index.ship.columns", "index.ship.rows");
  $("cost-table").innerHTML = table("index.cost.columns", "index.cost.rows");

  RZ.renderFootnotes($("fn-host"));
  RZ.buildToc();
  RZ.settleHash();
})();
