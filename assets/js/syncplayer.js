/* SyncPlayer — YouTube video (left) + a transcript pane (right; stacked on phone) that writes itself as the lesson plays.
 *
 * new SyncPlayer(host, stt)   stt = data/<lang>/stt.json  { video:{youtube_id,title,channel,url,start,end}, turns:[{start,end,speaker,text,en}], baseline:{engine,from,to,text} }
 *   - polls player.getCurrentTime() ~4×/s and interpolates between polls with requestAnimationFrame, so typing is smooth;
 *   - a turn is hidden until the video reaches turn.start, then typed in over (end − start) and highlighted while current;
 *   - scrubbing backwards re-hides later turns; clicking a turn seeks to it;
 *   - per-turn "English" toggle; a "today's production engine heard…" toggle shows the baseline text for its window;
 *   - "Show full transcript" reveals every turn at once (for reading without the video, and for screen readers).
 * SyncPlayer.byLang[lang].seekPlay(t)  used by the coach report's timestamp buttons: scrolls here, seeks, plays.
 */
(function () {
  let apiPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = rej;
      document.head.appendChild(s);
      setTimeout(() => rej(new Error("youtube api timeout")), 15000);
    });
    return apiPromise;
  }

  class SyncPlayer {
    constructor(host, stt, opts) {
      this.host = host; this.stt = stt; this.opts = opts || {};
      this.turns = (stt.turns || []).slice().sort((a, b) => a.start - b.start);
      this.v = stt.video || {};
      this.t = 0; this.playing = false; this.showAll = false; this.lastPoll = 0; this.lastT = 0;
      this.cur = -1; this.ready = false;
      SyncPlayer.byLang[stt.lang] = this;
      this.render();
      this.mountPlayer();
    }

    render() {
      const RZ = window.RZ, el = RZ.el, v = this.v;
      const id = "yt-" + (this.stt.lang || Math.random().toString(36).slice(2));
      this.box = el("div", { class: "video-box" }, el("div", { id }));
      this.playerId = id;
      const credit = el("p", { class: "video-credit" },
        `${RZ.ui("video", "Video")}: `, el("a", { href: v.url || `https://www.youtube.com/watch?v=${v.youtube_id}`, target: "_blank", rel: "noopener" }, v.title || ""),
        v.channel ? ` · ${v.channel}` : "");
      this.list = el("ol", { class: "turns", "aria-live": "off", "aria-label": RZ.ui("transcript", "Transcript") });
      this.hint = el("li", { class: "hint" }, RZ.ui("press_play", "Press play — the transcript appears as the lesson is spoken."));
      this.list.append(this.hint);
      this.rows = this.turns.map((tu, i) => {
        const txt = el("span", { class: "txt-inner" });
        const caret = el("span", { class: "caret", "aria-hidden": "true" });
        const en = el("div", { class: "en", hidden: true }, tu.en || "");
        const enBtn = tu.en ? el("button", { class: "btn small en-t", type: "button", "aria-pressed": "false",
          "aria-label": `${RZ.ui("english", "English")} — ${RZ.fmt(tu.start)}`,
          onclick: (e) => { e.stopPropagation(); const on = en.hidden; en.hidden = !on; enBtn.setAttribute("aria-pressed", String(on)); } }, (this.opts.english || RZ.ui("english", "English"))) : null;
        const spk = String(tu.speaker || "").toLowerCase();
        const li = el("li", { class: `turn spk-${spk}`, hidden: true, tabindex: "0", role: "button",
          "aria-label": `${tu.speaker} ${RZ.fmt(tu.start)} — ${RZ.ui("seek", "play from here")}`,
          onclick: () => this.seek(tu.start, true),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.seek(tu.start, true); } } },
          el("div", { class: "who" }, el("span", {}, this.speakerLabel(tu.speaker)), el("span", { class: "time" }, RZ.fmt(tu.start)), enBtn),
          el("div", { class: "txt" }, txt, caret), en);
        this.list.append(li);
        return { li, txt, caret, tu, shown: -1 };
      });

      const bar = el("div", { class: "bar" }, el("span", { class: "t" }, RZ.ui("transcript", "Transcript")));
      this.allBtn = el("button", { class: "btn small", type: "button", "aria-pressed": "false", onclick: () => this.toggleAll() }, RZ.ui("show_all", "Show full transcript"));
      bar.append(this.allBtn);
      const b = this.stt.baseline;
      if (b && b.text) {
        this.baseBox = el("div", { class: "baseline", hidden: true },
          el("span", { class: "lab" }, `${this.opts.baseline || RZ.ui("baseline_heard", "Today's production engine heard")} (${RZ.fmt(b.from)}–${RZ.fmt(b.to)})`),
          b.text);
        this.baseBtn = el("button", { class: "btn small", type: "button", "aria-pressed": "false", onclick: () => this.toggleBase() },
          this.opts.baseline || RZ.ui("baseline_toggle", "Today's production engine heard…"));
        bar.append(this.baseBtn);
      }
      const pane = el("div", { class: "transcript", role: "region", "aria-label": RZ.ui("transcript", "Transcript") }, bar, this.list, this.baseBox || "");
      this.host.innerHTML = "";
      this.host.append(el("div", { class: "sync" }, el("div", {}, this.box, credit), el("div", { class: "tcol" }, pane)));
    }

    speakerLabel(s) {
      const RZ = window.RZ, k = String(s || "").toLowerCase();
      return RZ.ui("speaker_" + k, s || "");
    }

    mountPlayer() {
      const v = this.v;
      loadYT().then((YT) => {
        this.player = new YT.Player(this.playerId, {
          videoId: v.youtube_id,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(v.start || 0), cc_load_policy: 0 },
          events: {
            onReady: () => { this.ready = true; this.loop(); },
            onStateChange: (e) => { this.playing = e.data === 1; this.poll(); if (e.data === 1 && this.pendingPlay) this.pendingPlay = false; },
          },
        });
      }).catch(() => {
        // No API (blocked/offline): plain embed + full transcript so nothing is lost.
        this.box.innerHTML = `<iframe title="${window.RZ.esc(v.title || "")}" src="https://www.youtube.com/embed/${v.youtube_id}" allow="encrypted-media" allowfullscreen></iframe>`;
        this.toggleAll(true);
      });
    }

    poll() {
      if (!this.player || !this.player.getCurrentTime) return;
      this.lastT = this.player.getCurrentTime() || 0;
      this.lastPoll = performance.now();
    }
    loop() {
      let pollAt = 0;
      const tick = (now) => {
        if (now - pollAt > 250) { this.poll(); pollAt = now; }
        this.t = this.playing ? this.lastT + (now - this.lastPoll) / 1000 : this.lastT;
        this.update(this.t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    update(t) {
      let cur = -1;
      const anyShown = this.showAll || t >= (this.turns[0] ? this.turns[0].start : 0) - 0.05 && t > 0.2;
      this.hint.hidden = !!anyShown;
      this.rows.forEach((r, i) => {
        const { start, end } = r.tu;
        const text = r.tu.text || "";
        let n;
        if (this.showAll || t >= end) n = text.length;
        else if (t < start) n = -1;
        else { n = Math.max(1, Math.ceil(text.length * (t - start) / Math.max(0.3, end - start))); cur = i; }
        if (t >= start && t < end) cur = i;
        if (n !== r.shown) {
          r.li.hidden = n < 0;
          r.txt.textContent = n < 0 ? "" : text.slice(0, n);
          r.caret.hidden = !(n >= 0 && n < text.length);
          r.shown = n;
        }
        const b = this.stt.baseline;
        r.li.classList.toggle("in-window", !!(this.baseOn && b && r.tu.start < b.to && r.tu.end > b.from));
      });
      if (cur !== this.cur) {
        if (this.cur >= 0 && this.rows[this.cur]) this.rows[this.cur].li.classList.remove("now");
        if (cur >= 0) {
          const li = this.rows[cur].li;
          li.classList.add("now");
          // scroll the pane only, never the page
          const top = li.offsetTop - this.list.offsetTop - 12;
          if (top < this.list.scrollTop || top + li.offsetHeight > this.list.scrollTop + this.list.clientHeight - 24) this.list.scrollTop = Math.max(0, top - 40);
        }
        this.cur = cur;
      }
      if (cur >= 0 && !this.showAll) {
        // keep the typing line in view while it grows
        const li = this.rows[cur].li, bottom = li.offsetTop - this.list.offsetTop + li.offsetHeight;
        if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight + 16;
      }
    }

    seek(t, play) {
      if (!this.player || !this.player.seekTo) {
        window.open(`https://www.youtube.com/watch?v=${this.v.youtube_id}&t=${Math.floor(t)}s`, "_blank", "noopener");
        return;
      }
      this.player.seekTo(t, true);
      this.lastT = t; this.lastPoll = performance.now();
      if (play) this.player.playVideo();
    }
    /** Scroll the player into view, seek and play (used by the coach report). */
    seekPlay(t) {
      this.host.scrollIntoView({ behavior: "smooth", block: "start" });
      this.seek(Math.max(0, t - 0.5), true);
    }
    toggleAll(force) {
      this.showAll = force === undefined ? !this.showAll : force;
      this.allBtn.setAttribute("aria-pressed", String(this.showAll));
      this.allBtn.textContent = this.showAll ? window.RZ.ui("show_live", "Follow the video") : window.RZ.ui("show_all", "Show full transcript");
      this.rows.forEach((r) => (r.shown = -2));
      this.update(this.t);
    }
    toggleBase() {
      this.baseOn = !this.baseOn;
      this.baseBox.hidden = !this.baseOn;
      this.baseBtn.setAttribute("aria-pressed", String(this.baseOn));
      if (this.baseOn && this.stt.baseline) {
        const b = this.stt.baseline;
        if (!this.showAll && this.t < b.from) this.seek(b.from, false);
      }
    }
  }
  SyncPlayer.byLang = {};
  window.SyncPlayer = SyncPlayer;
})();
