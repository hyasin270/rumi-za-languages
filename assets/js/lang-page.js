/* lang-page.js — renders zu.html / xh.html / st.html (identical layout; <body data-lang="…">).
 * Data: data/<lang>/{vision,lp,stt,coach,tts}.json (+ partner_note.json where a page has partner results) and data/summary.json.
 * Copy keys resolve "<lang>.<key>" first (e.g. "zu.listening.lead"), then "lang.<key>", then "<key>".
 * A missing data file renders a "coming shortly" panel in its place; nothing else breaks.
 */
(async function () {
  // The partner classroom recording each page plays (the same one the listening review hosts). data/<lang>/stt.json "media" wins;
  // until it carries one, the page plays this recording from the review data, so it never falls back to a public video.
  const PARTNER_REC = { zu: "zu-vvob-m6-l6", xh: "xh-fw-what-is-orf", st: "st-fw-syllable-cards" };
  const PARTNER = ["zu"];
  const RZ = window.RZ, lang = document.body.dataset.lang, $ = (id) => document.getElementById(id), esc = RZ.esc;
  await RZ.boot({ lang });
  const name = RZ.langName(lang);
  document.title = `${name} — ${RZ.t("index.meta.title") || "Rumi in South African languages"}`;
  RZ.fillCopy();
  // optional copy: hide empty notes rather than showing placeholders for them
  document.querySelectorAll("p.note[data-copy], .vmaterial[data-copy]").forEach((n) => { if (!RZ.has(n.getAttribute("data-copy"))) n.hidden = true; });

  const files = ["data/summary.json", `data/${lang}/vision.json`, `data/${lang}/lp.json`, `data/${lang}/stt.json`, `data/${lang}/coach.json`, `data/${lang}/tts.json`];
  // partner results exist for isiZulu only; fetching the file elsewhere would log a 404
  if (PARTNER.includes(lang)) files.push(`data/${lang}/partner_note.json`);
  let [summary, vision, lp, stt, coach, tts, partner] = await Promise.all(files.map(RZ.load));
  // partner recording: the hosted media + synced transcript + the coaching report on THAT recording
  let rec = null;
  const recId = (stt && stt.rec_id) || PARTNER_REC[lang];
  if (recId) {
    const index = await RZ.load("data/review/index.json");
    rec = ((index && index.recordings) || []).find((r) => r.id === recId) || null;
  }
  if (!(stt && stt.media && (stt.media.src || stt.media.youtube_id)) && rec && rec.media && rec.media.src) {
    const rv = await RZ.load(`data/review/${recId}.json`);
    stt = rv ? Object.assign({}, rv, { lang, media: rec.media, title: rec.title_en || rec.title }) : null;
  }
  if (!(coach && (coach.media_id || coach.media)) && rec && rec.has_coaching !== false) {
    const rc = await RZ.load(`data/review/${recId}.coach.json`);
    if (rc) coach = rc;
  }
  // word timings may be inline arrays or paths to JSON files
  if (lp && lp.voice_note) lp.voice_note.words = await RZ.words(lp.voice_note.words);
  if (coach && coach.voice) coach.voice.words = await RZ.words(coach.voice.words);
  if (tts) for (const m of tts.conversation || []) if (m.words) m.words = await RZ.words(m.words);

  /* 0. verdict strip: the four scores (from summary.json) + verdict */
  const row = summary && (summary.rows || []).find((r) => (r.code || r.lang) === lang);
  const Q = [["Q1", "#lesson-plans", "Lesson plans"], ["Q2", "#listening", "Listening"], ["Q3", "#coaching", "Coaching"], ["Q4", "#speaking", "Speaking"]];
  const cells = (row && row.cells) || {};
  $("verdict-chips").innerHTML = Q.map(([k, href, f]) => RZ.chip(cells[k], { key: RZ.t("verdict.chips." + k) || f, href })).join(" ") +
    (cells.verdict ? " " + RZ.chip(cells.verdict, { noLabel: true }) : "");

  /* 1. lesson plans */
  if (vision) VisionDiff.mount($("vision-host"), vision, { left: RZ.html("vision.caption_left"), right: RZ.t("vision.caption_right"), chips: RZ.raw("vision.chips"), hasNote: RZ.has("vision.note") });
  else $("vision-host").innerHTML = RZ.soon(RZ.ui("soon_vision", "the page-reading comparison"));
  if (lp) {
    LPViewer.mount($("lp-host"), lp, { pdf: RZ.t("lp_sample.pdf"), reviewer: RZ.t("lp_sample.reviewer_pdf"), btHeading: RZ.t("lp_sample.backtranslation_heading"), btCols: RZ.raw("lp_sample.backtranslation_columns") });
    const vn = lp.voice_note || {};
    if (vn.mp3) Karaoke.mount($("voicenote-host"), { mp3: vn.mp3, words: vn.words, text: vn.script, en: vn.script_en || vn.en, lang, label: RZ.t("voice_note.heading") || "Voice note" });
    else $("voicenote-host").innerHTML = RZ.soon(RZ.ui("soon_voicenote", "the voice note"));
  } else { $("lp-host").innerHTML = RZ.soon(RZ.ui("soon_lp", "the lesson-plan sample")); $("voicenote-host").innerHTML = RZ.soon(RZ.ui("soon_voicenote", "the voice note")); }

  /* 2. listening — a partner classroom recording, hosted, played through the review page's media adapter */
  if (stt && stt.media) {
    const credit = rec ? [rec.title_en || rec.title, rec.partner].filter(Boolean).join(" · ") : stt.title || "";
    new SyncPlayer($("sync-host"), Object.assign({}, stt, { lang }), { key: lang, credit, english: RZ.t("listening.english_toggle") || undefined });
    const line = (s, key) => `<div class="score-line">${RZ.chip(s, { key })} <span class="note">${esc(RZ.score(s).line || "")}</span></div>`;
    $("stt-score").innerHTML = (stt.score ? (RZ.has("listening.score_line") ? `<div class="score-line">${RZ.chip(stt.score, { key: RZ.t("verdict.chips.Q2") || "Listening" })} <span class="note">${RZ.html("listening.score_line")}</span></div>` : line(stt.score, RZ.t("verdict.chips.Q2") || "Listening")) : "") +
      // two engines compared with each other: a proxy, never "AI-judged", whatever label the older data file carries
      (stt.agreement ? `<div class="score-line">${RZ.chip(Object.assign({}, RZ.score(stt.agreement), { label: "engine agreement (proxy)" }), { key: RZ.ui("stt_disagree", "Engines disagree on"), kind: Number(RZ.score(stt.agreement).value) <= 1 ? "pct-up" : "10" })} <span class="note">${
        RZ.has("listening.agreement_line") ? RZ.html("listening.agreement_line") : esc(RZ.score(stt.agreement).line || "")}</span></div>` : "") +
      ((stt.sources || []).length ? `<p class="note" style="margin-top:6px">${esc(RZ.ui("sources_label", "Sources"))} ${RZ.cite(stt.sources)}</p>` : "");
  } else $("sync-host").innerHTML = RZ.soon(RZ.ui("soon_stt", "the recording with its synced transcript"));

  /* 3. coaching (+ partner videos, isiZulu only) */
  if (coach) {
    Report.mount($("report-host"), coach, lang, { accuracyHeading: RZ.t("coaching.accuracy_heading"), accuracyNote: RZ.html("coaching.accuracy_note"), debriefHeading: RZ.t("coaching.debrief_heading"),
      debriefNote: RZ.has("coaching.debrief_note") ? RZ.html("coaching.debrief_note") : "" });
  } else $("report-host").innerHTML = RZ.soon(RZ.ui("soon_coach", "the coach's report"));
  if (partner) {
    const nums = (partner.numbers || []).map((n) => `<li><strong>${esc(n.name || "")}</strong>: ${esc(n.display || "")}${n.line ? ` <span class="note">${esc(n.line)}</span>` : ""}</li>`).join("");
    $("partner-host").innerHTML = `<div class="card" style="margin-top:16px"><p class="subcard-title">${esc(partner.title_en || "")}</p>${
      (partner.text_en || []).map((p) => `<p>${RZ.inline(p)}</p>`).join("")}${nums ? `<ul class="bullets">${nums}</ul>` : ""}${partner.measures ? `<p class="note">${esc(partner.measures)}${RZ.cite(partner.sources)}</p>` : ""}</div>`;
  }

  /* 4. speaking */
  if (tts) {
    Chat.mount($("chat-host"), tts);
    const s = RZ.score(tts.score);
    $("tts-score").innerHTML = `<div class="score-line">${RZ.chip(s, { key: RZ.t("verdict.chips.Q4") || "Speaking" })} <span class="note">${RZ.has("speaking.score_line") ? RZ.html("speaking.score_line") : esc(s.line || "")}${RZ.cite(tts.sources)}</span></div>`;
    // the voices auditioned against the pick: same sentence each, AI-judged nativeness + measured round trip
    const trials = tts.voice_trials || [];
    if (trials.length) {
      const pct = (x) => (Math.ceil(x * 1000 - 1e-9) / 10).toFixed(1) + "%";   // error rates round up
      // round trip only: an AI-judged nativeness number never reaches the public page (first-language listeners disagreed with it)
      const items = trials.map((t) => `<li><span class="trial-label">${esc(t.label || "")}</span><audio controls preload="none" src="${esc(t.mp3 || "")}"></audio><span class="note">${
        t.cer != null ? `${pct(t.cer)} lost on the round trip (measured)` : ""}</span></li>`).join("");
      const box = document.createElement("div");
      box.className = "card trials";
      box.innerHTML = `<p class="subcard-title">${esc(RZ.t("speaking.trials_heading") || "Other voices we tried, reading the same sentence")}</p><ul class="trial-list">${items}</ul>`;
      (document.querySelector('[data-copy="speaking.note"]') || $("tts-score")).after(box);
    }
  } else $("chat-host").innerHTML = RZ.soon(RZ.ui("soon_tts", "the conversation"));
  // the speaking review for this language
  const sl = $("speak-link");
  if (sl) {
    if (RZ.has("speaking.review_line")) sl.innerHTML = RZ.html("speaking.review_line").replace(/href="speak\.html"/g, `href="speak.html?lang=${lang}"`);
    else sl.innerHTML = `<a href="speak.html?lang=${lang}">${RZ.placeholder("speaking.review_line")}</a>`;
    sl.hidden = false;
  }

  RZ.renderFootnotes($("fn-host"));
  RZ.buildToc();
  RZ.settleHash();
})();
