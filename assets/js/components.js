/* components.js — Chat, Report, VisionDiff, LPViewer. Each renders straight from one data file.
 *
 * Chat.mount(host, tts)            WhatsApp-like thread: teacher text bubbles (right); Rumi voice-note bubbles (left) that play as Karaoke.
 * Report.mount(host, coach, lang)  the coach's report: steps grouped seen / partly / not observed, verbatim evidence with timestamp
 *                                  buttons that seek+play that page's SyncPlayer; positives, blockages, level of change, GROW,
 *                                  reflective questions (language + English), 5-step debrief plan, next step, spoken debrief
 *                                  (Karaoke), and the "how well Rumi observed" accuracy panel.
 * VisionDiff.mount(host, vision)   the workbook page image beside Rumi's full reconstruction of it (vision.pagetruth).
 * LPViewer.mount(host, lp)         page thumbnails → lightbox, PDF + English reviewer copy, score parts, back-translation.
 */
(function () {
  const RZ = () => window.RZ;
  const L = (k, f) => window.RZ.ui(k, f);

  /* ---------------- Chat ---------------- */
  const Chat = {
    mount(host, tts) {
      const { el, esc } = RZ();
      const thread = el("div", { class: "chat", role: "log", "aria-label": L("chat_label", "Conversation between a teacher and Rumi") });
      (tts.conversation || []).forEach((m, i) => {
        if (m.from === "teacher") {
          thread.append(el("div", { class: "bubble teacher" },
            el("div", { class: "from" }, L("teacher", "Teacher")),
            el("div", { lang: tts.lang }, m.text || ""),
            m.en ? el("div", { class: "en" }, m.en) : ""));
        } else {
          const b = el("div", { class: "bubble rumi" }, el("div", { class: "from" }, "Rumi"));
          if (m.mp3) window.Karaoke.mount(b, { mp3: m.mp3, words: m.words, text: m.text, en: m.en, lang: tts.lang, label: `${L("voice_note", "Voice note")} ${i + 1}`, compact: true });
          else { b.append(el("div", { lang: tts.lang }, m.text || "")); if (m.en) b.append(el("div", { class: "en" }, m.en)); }
          thread.append(b);
        }
      });
      host.append(thread);
    },
  };

  /* ---------------- Report ---------------- */
  function tsBtn(lang, t) {
    const { el, fmt } = RZ();
    if (t === null || t === undefined || t === "") return el("span", {});
    return el("button", { class: "ts", type: "button", "aria-label": `${L("play_at", "Play the video at")} ${fmt(t)}`,
      onclick: () => {
        const p = window.SyncPlayer && window.SyncPlayer.byLang[lang];
        if (p) p.seekPlay(Number(t));
        else if (Report.youtubeId) window.open(`https://www.youtube.com/watch?v=${Report.youtubeId}&t=${Math.floor(t)}s`, "_blank", "noopener");
      } }, "▶ " + fmt(t));
  }
  function bil(o, lang) {
    const { el } = RZ();
    if (!o) return el("span", {});
    return el("div", { class: "bil" }, o.lang ? el("div", { class: "l", lang }, o.lang) : "", o.en ? el("div", { class: "e" }, o.en) : "");
  }
  const STATUS = { seen: ["seen", "Seen"], partly: ["partly", "Partly seen"], not_observed: ["not_observed", "Not observed in this video"] };
  const statusChip = (s) => { const [c, f] = STATUS[s] || STATUS.not_observed; return `<span class="status ${c}">${window.RZ.esc(L("status_" + c, f))}</span>`; };

  const Report = {
    mount(host, c, lang, o) {
      o = o || {};
      Report.youtubeId = c.youtube_id;
      const { el, esc, chip, cite } = RZ();
      const card = el("div", { class: "card report" });
      const meta = el("div", { class: "meta" });
      const ls = c.lesson || {};
      [ls.grade, ls.strand, ls.focus].filter(Boolean).forEach((x) => meta.append(el("span", {}, x)));
      card.append(meta);
      if (c.summary_en) card.append(el("p", { class: "summary-en" }, c.summary_en));
      if (c.scope_en) card.append(el("p", { class: "note" }, c.scope_en));
      card.append(el("div", { class: "legend", html:
        `${statusChip("seen")} ${statusChip("partly")} ${statusChip("not_observed")} <span>${esc(L("legend_ts", "Every timestamp plays that moment in the video above."))}</span>` }));

      const stepBlock = (title, steps) => {
        if (!steps || !steps.length) return;
        const wrap = el("div", { class: "step-group" }, el("h4", {}, title));
        ["seen", "partly", "not_observed"].forEach((st) => {
          steps.filter((s) => (s.status || "not_observed") === st).forEach((s) => {
            const ev = el("ul", { class: "evidence" });
            (s.evidence || []).forEach((e) => ev.append(el("li", {}, tsBtn(lang, e.t), el("q", { lang }, e.quote || ""), e.en ? el("span", { class: "qen" }, e.en) : "")));
            wrap.append(el("div", { class: `step ${st}` },
              el("div", { class: "head", html: `${statusChip(st)} <span class="name">${esc(s.name_en || s.name || "")}</span>${s.name && s.name_en ? ` <span class="name-l" lang="${esc(lang)}">${esc(s.name)}</span>` : ""}` }),
              s.note_en ? el("p", { class: "note-en" }, s.note_en) : "", (s.evidence || []).length ? ev : ""));
          });
        });
        card.append(wrap);
      };
      stepBlock(L("lesson_steps", "Lesson steps"), c.steps);
      stepBlock(L("classroom_culture", "Classroom culture"), c.culture);

      const two = el("div", { class: "grid-2" });
      const pb = (title, items) => {
        const box = el("div", { class: "card" }, el("p", { class: "subcard-title" }, title));
        const ul = el("ul", { class: "pb-list" });
        (items || []).forEach((p) => ul.append(el("li", {}, tsBtn(lang, p.t), el("span", {}, p.en || ""))));
        box.append(ul); return box;
      };
      if ((c.positives || []).length || (c.blockages || []).length) {
        two.append(pb(L("positives", "What worked"), c.positives), pb(L("blockages", "What got in the way"), c.blockages));
        card.append(two);
      }
      if (c.level_of_change) {
        card.append(el("div", { class: "card" }, el("p", { class: "subcard-title" }, L("level_of_change", "Level of change")),
          el("p", { style: "margin:0" }, el("strong", {}, typeof c.level_of_change.level === "number" ? `${L("level", "Level")} ${c.level_of_change.level}` : (c.level_of_change.level || "")), c.level_of_change.en ? " — " + c.level_of_change.en : "")));
      }
      if (c.grow) {
        const g = el("div", { class: "grow" });
        [["goal", "G", "Goal"], ["reality", "R", "Reality"], ["options", "O", "Options"], ["way_forward", "W", "Way forward"]].forEach(([k, letter, name]) => {
          if (!c.grow[k]) return;
          g.append(el("div", {}, el("div", { html: `<span class="g">${letter}</span><strong>${esc(L("grow_" + k, name))}</strong>` }), bil(c.grow[k], lang)));
        });
        card.append(el("div", { class: "card" }, el("p", { class: "subcard-title" }, L("grow", "GROW goal")), g));
      }
      if ((c.questions || []).length) {
        const ol = el("ol", { class: "plan" });
        c.questions.forEach((q) => ol.append(el("li", {}, bil(q, lang), q.t !== undefined ? el("div", { style: "margin-top:4px" }, tsBtn(lang, q.t)) : "")));
        card.append(el("div", { class: "card" }, el("p", { class: "subcard-title" }, L("questions", "Three reflective questions")), ol));
      }
      if ((c.debrief_plan || []).length) {
        const ol = el("ol", { class: "plan" });
        c.debrief_plan.forEach((d) => ol.append(el("li", {}, el("strong", {}, d.step_en || ""), bil({ lang: d.coach_says, en: d.en }, lang))));
        card.append(el("div", { class: "card" }, el("p", { class: "subcard-title" }, L("debrief_plan", "The coach's five-step debrief")), ol));
      }
      if (c.next_step) card.append(el("div", { class: "card", style: "border-left:4px solid var(--coral)" }, el("p", { class: "subcard-title" }, L("next_step", "One next step")), bil(c.next_step, lang)));
      if (c.voice && c.voice.mp3) {
        const v = el("div", { class: "card" }, el("p", { class: "subcard-title" }, o.debriefHeading || L("spoken_debrief", "The spoken debrief")));
        window.Karaoke.mount(v, { mp3: c.voice.mp3, words: c.voice.words, text: c.voice.script, en: c.voice.en || c.voice.script_en, lang, label: L("spoken_debrief", "The spoken debrief") });
        card.append(v);
      }
      const a = c.accuracy;
      if (a) {
        const title = o.accuracyHeading || L("accuracy_title", "How well Rumi observed");
        const acc = el("div", { class: "accuracy", role: "group", "aria-label": title });
        acc.append(el("h4", {}, title));
        acc.append(el("div", { class: "chip-row", html: chip({ value: a.score, label: a.label }, { key: L("acc_overall", "Overall") }) }));
        const items = el("ul", { class: "acc-items" });
        [["grounding", "Grounding"], ["coverage", "Coverage"], ["stability", "Stability"]].forEach(([k, f]) => {
          const x = a[k];
          if (x === undefined || x === null) return;
          const txt = typeof x === "object" ? (x.display || (x.value !== undefined ? window.RZ.trunc(x.value * 100, 0) + "%" : "")) : window.RZ.trunc(Number(x) * 100, 0) + "%";
          items.append(el("li", {}, el("strong", {}, L("acc_" + k, f) + ": "), txt));
        });
        acc.append(items);
        acc.append(el("p", { html: (o.accuracyNote && !/class="ph"/.test(o.accuracyNote) ? o.accuracyNote : esc(a.line || L("acc_not_teacher", "These numbers measure Rumi, not the teacher."))) + cite(c.sources) }));
        if (c.model) acc.append(el("p", { class: "acc-model" }, c.model));
        card.append(acc);
      }
      host.append(card);
    },
  };

  /* ---------------- Lightbox (shared) ---------------- */
  let dlg;
  function lightbox(images, i, alts) {
    const { el } = RZ();
    if (!dlg) {
      dlg = el("dialog", { class: "lightbox", "aria-label": L("enlarged", "Enlarged page") });
      dlg.innerHTML = `<img alt=""><div class="lb-bar"><button class="btn" data-a="prev" type="button">‹ ${L("prev", "Previous")}</button><span class="lb-count"></span><button class="btn" data-a="next" type="button">${L("next", "Next")} ›</button><button class="btn primary" data-a="close" type="button">${L("close", "Close")}</button></div>`;
      document.body.append(dlg);
      dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") dlg._go(1); if (e.key === "ArrowLeft") dlg._go(-1); });
      dlg.querySelector("[data-a=prev]").onclick = () => dlg._go(-1);
      dlg.querySelector("[data-a=next]").onclick = () => dlg._go(1);
      dlg.querySelector("[data-a=close]").onclick = () => dlg.close();
    }
    let k = i;
    const show = () => {
      const img = dlg.querySelector("img");
      img.src = images[k]; img.alt = (alts && alts[k]) || `${L("page", "Page")} ${k + 1}`;
      dlg.querySelector(".lb-count").textContent = `${k + 1} / ${images.length}`;
      dlg.querySelector("[data-a=prev]").hidden = dlg.querySelector("[data-a=next]").hidden = images.length < 2;
    };
    dlg._go = (d) => { k = (k + d + images.length) % images.length; show(); };
    show();
    dlg.showModal();
    dlg.querySelector("[data-a=close]").focus();
  }

  /* ---------------- VisionDiff ---------------- */
  const VisionDiff = {
    mount(host, v, o) {
      o = o || {};
      const { el, esc, chip, cite, trunc } = RZ();
      const p = v.page || {};
      const fig = el("figure", {});
      if (p.image) {
        const img = el("img", { src: p.image, alt: `${p.book || ""} ${L("page", "page")} ${p.printed_page || ""}`.trim(), loading: "lazy", tabindex: "0",
          onclick: () => lightbox([p.image], 0), onkeydown: (e) => { if (e.key === "Enter") lightbox([p.image], 0); } });
        fig.append(img);
      }
      fig.append(el("figcaption", { html: `${o.left && !/class="ph"/.test(o.left) ? o.left + "<br>" : ""}${esc(p.book || "")}${p.printed_page ? `, ${esc(L("page", "page"))} ${esc(p.printed_page)}` : ""}${cite(p.source ? [p.source] : v.sources)}` }));
      const right = el("div", {});
      right.append(el("p", { class: "subcard-title" }, o.right || L("vision_read", "Rumi's reconstruction of the page")));
      // the page as Rumi rebuilt it from the image: worksheet + title, week, activity + instruction, pictures + labels,
      // printed page number, and the printer's margin stamp (which learners never see)
      const pt = v.pagetruth || {};
      const page = el("div", { class: "ptpage", lang: v.lang });
      page.append(el("div", { class: "pt-top" }, pt.worksheet ? el("span", { class: "pt-ws" }, pt.worksheet) : "", el("span", { class: "pt-title" }, pt.title || "")));
      if (pt.week) page.append(el("div", { class: "pt-week" }, pt.week));
      if (pt.activity && (pt.activity.label || pt.activity.instruction)) {
        page.append(el("div", { class: "pt-activity" },
          pt.activity.label ? el("span", { class: "pt-act-label" }, pt.activity.label) : "",
          pt.activity.instruction ? el("p", { class: "pt-instr" }, pt.activity.instruction) : ""));
      }
      (pt.pictures || []).forEach((pic) => {
        const box = el("div", { class: "pt-pic" },
          el("div", { class: "pt-pic-desc", lang: "en" }, el("span", { class: "pt-pic-tag" }, L("picture", "Picture")), " ", pic.description || ""));
        if ((pic.labels || []).length) {
          const row = el("div", { class: "pt-labels" });
          pic.labels.forEach((w) => row.append(el("span", { class: "pt-label" }, w)));
          box.append(row);
        }
        page.append(box);
      });
      if (pt.printed_page !== undefined && pt.printed_page !== null) page.append(el("div", { class: "pt-pageno" }, String(pt.printed_page)));
      if ((pt.margin_stamp || []).length) {
        page.append(el("div", { class: "pt-stamp", lang: "en" },
          el("span", {}, L("stamp", "Printer's margin stamp (learners never see it): ")),
          el("code", {}, pt.margin_stamp.join(" · ")),
          pt.stamp_unsure ? el("span", { class: "pt-unsure" }, L("unsure", "Rumi marked this line as unsure")) : ""));
      }
      right.append(page);
      const meta = [pt.labels && pt.labels.length ? `${pt.labels.length} ${L("labels", "labels")}` : "", pt.pictures && pt.pictures.length ? `${pt.pictures.length} ${L("pictures", "pictures")}` : "", pt.captured || ""].filter(Boolean).join(" · ");
      if (meta) right.append(el("p", { class: "note pt-meta" }, meta));
      // chips: every word a learner sees on this page, then the language overall
      const ch = o.chips || {};
      const chips = [];
      if (v.score_without_stamp !== undefined && v.score_without_stamp !== null)
        chips.push(chip({ value: v.score_without_stamp, label: v.score_label || "measured" }, { key: ch.learner_visible || L("learner_visible", "Every word a learner sees, this page") }));
      if (v.overall) chips.push(chip({ value: v.overall.score, label: v.overall.label }, { key: ch.overall || L("page_truth_all", "Page reading, all test pages") }));
      right.append(el("div", { class: "chip-row vchips", html: chips.join(" ") }));
      if (v.why_en) right.append(el("p", { class: "note", style: "margin-top:10px" }, v.why_en));
      if (v.overall && v.overall.line) right.append(el("p", { class: "note", style: "margin:6px 0 0" }, v.overall.line));
      host.append(el("div", { class: "vdiff" }, fig, right));
    },
  };

  /* ---------------- LPViewer ---------------- */
  const LPViewer = {
    mount(host, lp, o) {
      o = o || {};
      const { el, esc, chip, cite } = RZ();
      const ls = lp.lesson || {};
      const card = el("div", { class: "card" });
      card.append(el("h3", { lang: lp.lang }, ls.title || ""));
      const bits = [ls.title_en, ls.topic_en, ls.week !== undefined ? `${L("week", "Week")} ${ls.week}` : "", ls.day !== undefined ? `${L("day", "day")} ${ls.day}` : "", ls.minutes ? `${ls.minutes} ${L("minutes", "minutes")}` : "", ls.caps_ref].filter(Boolean);
      card.append(el("p", { class: "note", html: esc(bits.join(" · ")) + cite(lp.sources) }));
      const pages = lp.pages || [];
      if (pages.length) {
        const th = el("div", { class: "thumbs" });
        pages.forEach((src, i) => th.append(el("button", { type: "button", "aria-label": `${L("open_page", "Open page")} ${i + 1}`, onclick: () => lightbox(pages, i) },
          el("img", { src, alt: `${L("page", "Page")} ${i + 1}`, loading: "lazy" }))));
        card.append(th);
      }
      const btns = el("div", { class: "chip-row" });
      if (lp.pdf) btns.append(el("a", { class: "btn primary", href: lp.pdf, target: "_blank", rel: "noopener" }, o.pdf || L("open_pdf", "Open the lesson plan (PDF)")));
      if (lp.reviewer_pdf) btns.append(el("a", { class: "btn", href: lp.reviewer_pdf, target: "_blank", rel: "noopener" }, o.reviewer || L("open_reviewer", "English reviewer copy (PDF)")));
      card.append(btns);
      const s = lp.scores || {};
      const parts = [
        ["q1", L("lp_overall", "Lesson plans overall"), "measured"],
        ["page_truth", L("page_truth", "Page truth"), "measured"],
        ["segmentation", L("segmentation", "Lesson segmentation"), "measured"],
        ["real_words", L("real_words", "Real words"), "measured"],
        ["wb_structure", L("wb_structure", "Lesson structure"), "AI-judged"],
      ].filter(([k]) => s[k] !== undefined && s[k] !== null);
      if (parts.length) {
        const sc = (k, lab) => (typeof s[k] === "object" ? s[k] : { value: s[k], label: lab });
        card.append(el("div", { class: "chip-row", style: "margin-top:14px", html: parts.map(([k, name, lab]) => chip(sc(k, lab), { key: name })).join(" ") }));
        const lines = parts.map(([k]) => sc(k).line).filter(Boolean);
        if (lines.length) card.append(el("details", { style: "margin-top:8px" }, el("summary", { class: "note" }, L("what_scores_mean", "What these scores mean")),
          el("ul", { class: "bullets note" }, lines.map((t) => el("li", {}, t)))));
      }
      if ((lp.backtranslation || []).length) {
        const tb = el("table", { class: "plain" });
        const cols = Array.isArray(o.btCols) && o.btCols.length === 3 ? o.btCols : [L("bt_line", "Line in the plan"), L("bt_says", "Back into English"), L("bt_should", "What it should say")];
        tb.innerHTML = `<thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
          lp.backtranslation.map((b) => `<tr><td lang="${esc(lp.lang)}">${esc(b.line)}</td><td>${esc(b.says)}</td><td>${esc(b.should)}</td></tr>`).join("")}</tbody>`;
        card.append(el("details", { style: "margin-top:14px" }, el("summary", {}, o.btHeading || L("backtranslation", "Back-translation check")), el("div", { class: "table-wrap", style: "margin-top:8px" }, tb),
          lp.backtranslation_label ? el("p", { class: "note", style: "margin-top:6px" }, lp.backtranslation_label) : ""));
      }
      if (lp.footer) { card.append(el("p", { class: "note", style: "margin:12px 0 0" }, lp.footer));
      }
      host.append(card);
    },
  };

  window.Chat = Chat; window.Report = Report; window.VisionDiff = VisionDiff; window.LPViewer = LPViewer; window.RZLightbox = lightbox;
})();
