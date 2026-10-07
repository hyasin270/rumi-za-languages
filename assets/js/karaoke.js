/* Karaoke — an <audio> player with a text pane whose words light up as they are spoken.
 *
 * Karaoke.mount(host, {mp3, words:[{w,s,e}], en, label, compact})
 *   - requestAnimationFrame on audio.currentTime while playing; the word with s ≤ t < e is lit, earlier words are marked done;
 *   - click a word → seek there and play;
 *   - controls: play/pause button (aria-label), a seek slider, elapsed / total time; Space on the slider toggles play;
 *   - only one Karaoke plays at a time on a page.
 * If words are missing, the text is shown without timing; if the mp3 is missing, a "coming shortly" note.
 */
(function () {
  const all = [];
  const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';

  function mount(host, o) {
    const RZ = window.RZ, el = RZ.el;
    o = o || {};
    const words = Array.isArray(o.words) ? o.words : [];
    const root = el("div", { class: "karaoke" + (o.compact ? " compact" : "") });
    if (!o.mp3) { host.append(root); root.innerHTML = RZ.soon(RZ.ui("audio", "audio")); return null; }
    const label = o.label || RZ.ui("voice_note", "Voice note");
    const audio = el("audio", { preload: "metadata", src: o.mp3 });
    const btn = el("button", { class: "k-play", type: "button", "aria-label": `${RZ.ui("play", "Play")}: ${label}`, html: ICON_PLAY });
    const range = el("input", { class: "k-range", type: "range", min: "0", max: "100", step: "0.1", value: "0", "aria-label": `${RZ.ui("position", "Position")}: ${label}` });
    const time = el("span", { class: "k-time", "aria-hidden": "true" }, "0:00");
    const text = el("div", { class: "k-text idle", lang: o.lang || null });
    const spans = words.map((w, i) => {
      const s = el("span", { class: "k-word", "data-i": i, onclick: () => { audio.currentTime = Math.max(0, w.s); audio.play(); } }, w.w);
      return s;
    });
    spans.forEach((s, i) => { text.append(s); if (i < spans.length - 1) text.append(" "); });
    if (!words.length && o.text) text.textContent = o.text;
    root.append(el("div", { class: "k-controls" }, btn, range, time), audio, text);
    if (o.en) root.append(el("div", { class: "k-en" }, o.en));
    host.append(root);

    let raf = 0, lit = -1;
    const dur = () => (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (words.length ? words[words.length - 1].e : 0));
    const paint = () => {
      const t = audio.currentTime, d = dur();
      range.value = d ? String((t / d) * 100) : "0";
      time.textContent = `${RZ.fmt(t)} / ${RZ.fmt(d)}`;
      let cur = -1, passed = 0;
      for (let i = 0; i < words.length; i++) {
        if (t >= words[i].e) passed = i + 1;
        if (cur < 0 && t >= words[i].s && t < words[i].e) cur = i;
      }
      const key = cur + ":" + passed;
      if (key !== lit) {
        spans.forEach((s, i) => { s.classList.toggle("on", i === cur); s.classList.toggle("done", i < passed && i !== cur); });
        lit = key;
      }
    };
    const loop = () => { paint(); raf = requestAnimationFrame(loop); };
    audio.addEventListener("play", () => {
      all.forEach((a) => { if (a !== audio) a.pause(); });
      text.classList.remove("idle"); btn.innerHTML = ICON_PAUSE; btn.setAttribute("aria-label", `${RZ.ui("pause", "Pause")}: ${label}`);
      cancelAnimationFrame(raf); loop();
    });
    const stop = () => { cancelAnimationFrame(raf); paint(); btn.innerHTML = ICON_PLAY; btn.setAttribute("aria-label", `${RZ.ui("play", "Play")}: ${label}`); };
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("loadedmetadata", paint);
    audio.addEventListener("seeked", paint);
    btn.addEventListener("click", () => (audio.paused ? audio.play() : audio.pause()));
    range.addEventListener("input", () => { audio.currentTime = (Number(range.value) / 100) * dur(); paint(); });
    range.addEventListener("keydown", (e) => { if (e.key === " ") { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); } });
    all.push(audio);
    paint();
    return { audio, root };
  }
  window.Karaoke = { mount };
})();
