/* lang-page.js — renders zu.html / xh.html / st.html (identical layout; <body data-lang="…">).
 * Data: data/<lang>/{vision,lp,stt,coach,tts}.json (+ partner_note.json where a page has partner results) and data/summary.json.
 * Copy keys resolve "<lang>.<key>" first (e.g. "zu.listening.lead"), then "lang.<key>", then "<key>".
 * A missing data file renders a "coming shortly" panel in its place; nothing else breaks.
 */
(async function () {
  // The three public demo lessons (title + channel credit only).
  const VIDEOS = { zu: { title: "Phonics - isiZulu" }, xh: { title: 'Phonics "tsh" - isiXhosa' }, st: { title: 'Phonics "ng" - seSotho' } };
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
  const [summary, vision, lp, stt, coach, tts, partner] = await Promise.all(files.map(RZ.load));
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

  /* 2. listening */
  if (stt) {
    new SyncPlayer($("sync-host"), stt, { english: RZ.t("listening.english_toggle"), baseline: RZ.t("listening.baseline_toggle") });
    const line = (s, key) => `<div class="score-line">${RZ.chip(s, { key })} <span class="note">${esc(RZ.score(s).line || "")}</span></div>`;
    $("stt-score").innerHTML = (stt.score ? (RZ.has("listening.score_line") ? `<div class="score-line">${RZ.chip(stt.score, { key: RZ.t("verdict.chips.Q2") || "Listening" })} <span class="note">${RZ.html("listening.score_line")}</span></div>` : line(stt.score, RZ.t("verdict.chips.Q2") || "Listening")) : "") +
      (stt.agreement ? `<div class="score-line">${RZ.chip(stt.agreement, { key: RZ.ui("stt_disagree", "Engines disagree on"), kind: Number(RZ.score(stt.agreement).value) <= 1 ? "pct-up" : "10" })} <span class="note">${
        RZ.has("listening.agreement_line") ? RZ.html("listening.agreement_line") : esc(RZ.score(stt.agreement).line || "")}</span></div>` : "") +
      ((stt.sources || []).length ? `<p class="note" style="margin-top:6px">${esc(RZ.ui("sources_label", "Sources"))} ${RZ.cite(stt.sources)}</p>` : "");
  } else if (coach && coach.youtube_id) {
    // transcript not delivered yet: still show the video so the report's timestamps can play it
    const v = VIDEOS[lang] || {};
    new SyncPlayer($("sync-host"), { lang, video: { youtube_id: coach.youtube_id, title: v.title || "", channel: "Mindset Teach", url: `https://www.youtube.com/watch?v=${coach.youtube_id}` }, turns: [] });
    $("stt-score").innerHTML = RZ.soon(RZ.ui("soon_stt_text", "the synced transcript"));
  } else $("sync-host").innerHTML = RZ.soon(RZ.ui("soon_stt", "the video with its synced transcript"));

  /* 3. coaching (+ partner videos, isiZulu only) */
  if (coach) {
    Report.mount($("report-host"), coach, lang, { accuracyHeading: RZ.t("coaching.accuracy_heading"), accuracyNote: RZ.html("coaching.accuracy_note"), debriefHeading: RZ.t("coaching.debrief_heading") });
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
  } else $("chat-host").innerHTML = RZ.soon(RZ.ui("soon_tts", "the conversation"));

  RZ.renderFootnotes($("fn-host"));
  RZ.buildToc();
  RZ.settleHash();
})();
