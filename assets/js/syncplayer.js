/* SyncPlayer — YouTube video (left) + a transcript pane (right; stacked on phone) that writes itself as the lesson plays.
 *
 * new SyncPlayer(host, stt)   stt = data/<lang>/stt.json  { video:{youtube_id,title,channel,url,start,end}, turns:[{start,end,speaker,text,en}], baseline:{engine,from,to,text} }
 *   - polls player.getCurrentTime() ~4×/s and interpolates between polls with requestAnimationFrame, so typing is smooth;
 *   - a turn is hidden until the video reaches turn.start, then typed in over (end − start) and highlighted while current;
 *   - scrubbing backwards re-hides later turns; clicking a turn seeks to it;
 *   - per-turn "English" toggle; an optional comparison toggle shows an alternative transcript for one window (stt.baseline, when present);
 *   - "Show full transcript" reveals every turn at once (for reading without the video, and for screen readers).
 * SyncPlayer.byLang[lang].seekPlay(t)  used by the coach report's timestamp buttons: scrolls here, seeks, plays.
 *
 * Hosted media (review page): pass stt.media = {type:"mp4"|"mp3"|"youtube", src, poster, youtube_id, start, end}. mp4/mp3 play in an
 * HTML5 <video>/<audio> through MediaAdapter, which offers the same calls as the YouTube player (getCurrentTime, seekTo, playVideo,
 * pauseVideo), so the transcript logic is shared. opts:
 *   key        register under SyncPlayer.byLang[key] instead of stt.lang
 *   startAt    open paused at this second (deep links); the transcript is revealed up to there; nothing plays until the viewer taps play
 *   turnExtra  (turn, i) → a node appended inside each turn (feedback buttons); clicks inside it never seek
 *   credit     a node/string replacing the "Video: title · channel" line ("" hides it)
 * player.highlight(i) marks turn i as the linked turn, reveals it and scrolls the transcript pane (never the page) to it.
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

  /** HTML5 <video>/<audio> behind the YouTube player's interface. Never autoplays. */
  class MediaAdapter {
    constructor(elm, media, onState) {
      this.el = elm; this.media = media || {}; this.pending = null;
      const apply = () => { if (this.pending !== null) { try { this.el.currentTime = this.pending; } catch (e) {} this.pending = null; } };
      elm.addEventListener("loadedmetadata", apply);
      ["play", "playing", "pause", "ended", "seeked", "waiting"].forEach((ev) => elm.addEventListener(ev, () => {
        if (ev === "playing" || ev === "play") onState(1);
        else if (ev === "pause" || ev === "ended") onState(2);
        else if (ev === "seeked") { if (this.touched) onState(-3, this.el.currentTime); }
        else onState(-2);
      }));
      // a seek only counts as the viewer's once they have touched the player (our own deep-link seek must not release the hold)
      ["pointerdown", "keydown"].forEach((ev) => elm.addEventListener(ev, () => (this.touched = true)));
      const end = Number(this.media.end);
      if (end > 0) elm.addEventListener("timeupdate", () => { if (elm.currentTime >= end && !elm.paused) elm.pause(); });
      if (Number(this.media.start) > 0) this.seekTo(Number(this.media.start));
    }
    getCurrentTime() { return this.pending !== null ? this.pending : this.el.currentTime || 0; }
    seekTo(t) { if (this.el.readyState >= 1) { try { this.el.currentTime = t; } catch (e) { this.pending = t; } } else this.pending = t; }
    playVideo() { const p = this.el.play(); if (p && p.catch) p.catch(() => {}); }
    pauseVideo() { this.el.pause(); }
  }

  class SyncPlayer {
    constructor(host, stt, opts) {
      this.host = host; this.stt = stt; this.opts = opts || {};
      this.turns = (stt.turns || []).slice().sort((a, b) => a.start - b.start);
      this.media = stt.media || null;
      this.html5 = !!(this.media && this.media.type && this.media.type !== "youtube");
      this.v = stt.video || (this.media ? { youtube_id: this.media.youtube_id, start: this.media.start, end: this.media.end, title: stt.title, url: this.media.youtube_id ? `https://www.youtube.com/watch?v=${this.media.youtube_id}` : "" } : {});
      if (this.opts.startAt != null && this.opts.startAt !== "") this.holdT = Math.max(0, Number(this.opts.startAt) || 0);
      this.t = 0; this.playing = false; this.showAll = false; this.lastPoll = 0; this.lastT = 0;
      this.cur = -1; this.ready = false;
      SyncPlayer.byLang[this.opts.key || stt.lang] = this;
      this.render();
      this.mountPlayer();
    }

    render() {
      const RZ = window.RZ, el = RZ.el, v = this.v;
      const id = "yt-" + (this.opts.key || this.stt.lang || Math.random().toString(36).slice(2));
      if (this.html5) {
        const m = this.media, audio = m.type === "mp3" || m.type === "audio";
        this.mediaEl = el(audio ? "audio" : "video", { controls: true, preload: "metadata", playsinline: true, "webkit-playsinline": true,
          poster: audio ? null : m.poster || null, "aria-label": this.stt.title || RZ.ui("recording", "Recording") });
        this.mediaEl.src = m.src;
        this.box = el("div", { class: "video-box" + (audio ? " audio-box" : "") }, m.poster && audio ? el("img", { src: m.poster, alt: "" }) : "", this.mediaEl);
      } else this.box = el("div", { class: "video-box" }, el("div", { id }));
      this.playerId = id;
      const credit = this.opts.credit !== undefined ? (this.opts.credit ? el("p", { class: "video-credit" }, this.opts.credit) : "") : el("p", { class: "video-credit" },
        `${RZ.ui("video", "Video")}: `, el("a", { href: v.url || `https://www.youtube.com/watch?v=${v.youtube_id}`, target: "_blank", rel: "noopener" }, v.title || ""),
        v.channel ? ` · ${v.channel}` : "");
      this.list = el("ol", { class: "turns", "aria-live": "off", "aria-label": RZ.ui("transcript", "Transcript") });
      this.hint = el("li", { class: "hint" }, this.turns.length ? RZ.ui("press_play", "Press play — the transcript appears as the lesson is spoken.") : RZ.ui("coming_transcript", "The transcript is coming shortly."));
      this.list.append(this.hint);
      this.rows = this.turns.map((tu, i) => {
        const txt = el("span", { class: "txt-inner" });
        const caret = el("span", { class: "caret", "aria-hidden": "true" });
        const en = el("div", { class: "en", hidden: true }, tu.en || "");
        const enBtn = tu.en ? el("button", { class: "btn small en-t", type: "button", "aria-pressed": "false",
          "aria-label": `${RZ.ui("english", "English")} — ${RZ.fmt(tu.start)}`,
          onclick: (e) => { e.stopPropagation(); const on = en.hidden; en.hidden = !on; enBtn.setAttribute("aria-pressed", String(on)); } }, (this.opts.english || RZ.ui("english", "English"))) : null;
        const spk = String(tu.speaker || "").toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/, "");
        const interview = tu.kind === "interview" || /interview/i.test(tu.speaker || "");
        const li = el("li", { class: `turn spk-${spk}${interview ? " interview" : ""}`, hidden: true, tabindex: "0", role: "button",
          "aria-label": `${tu.speaker} ${RZ.fmt(tu.start)} — ${RZ.ui("seek", "play from here")}`,
          onclick: () => this.seek(tu.start, true),
          onkeydown: (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); this.seek(tu.start, true); } } },
          el("div", { class: "who" }, el("span", {}, this.speakerLabel(tu.speaker) + (interview && !/interview/i.test(tu.speaker || "") ? ` (${RZ.ui("interview", "interview")})` : "")), el("span", { class: "time" }, RZ.fmt(tu.start)), enBtn),
          el("div", { class: "txt", lang: this.stt.lang || null }, txt, caret), en);
        if (this.opts.turnExtra) {
          const x = this.opts.turnExtra(tu, i, li);
          if (x) { x.addEventListener("click", (e) => e.stopPropagation()); li.append(x); }
        }
        this.list.append(li);
        return { li, txt, caret, tu, shown: -1 };
      });

      const bar = el("div", { class: "bar" }, el("span", { class: "t" }, RZ.ui("transcript", "Transcript")));
      this.allBtn = el("button", { class: "btn small", type: "button", "aria-pressed": "false", onclick: () => this.toggleAll() }, RZ.ui("show_all", "Show full transcript"));
      bar.append(this.allBtn);
      const b = this.stt.baseline;
      if (b && b.text) {
        this.baseBox = el("div", { class: "baseline", hidden: true },
          el("span", { class: "lab" }, `${this.opts.baseline || RZ.ui("baseline_heard", "Another engine heard")} (${RZ.fmt(b.from)}–${RZ.fmt(b.to)})`),
          b.text);
        this.baseBtn = el("button", { class: "btn small", type: "button", "aria-pressed": "false", onclick: () => this.toggleBase() },
          this.opts.baseline || RZ.ui("baseline_toggle", "Another engine heard…"));
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
      if (this.html5) {
        this.player = new MediaAdapter(this.mediaEl, this.media, (st, at) => {
          if (st === 1) { this.playing = true; this.holdT = null; } else if (st === 2) this.playing = false;
          else if (st === -3 && this.holdT != null && Math.abs(at - this.holdT) > 0.5) this.holdT = null; // the viewer scrubbed
          this.poll();
        });
        if (this.holdT != null) this.player.seekTo(this.holdT);
        this.ready = true; this.loop();
        return;
      }
      const startAt = this.holdT != null ? this.holdT : v.start || 0;
      loadYT().then((YT) => {
        this.player = new YT.Player(this.playerId, {
          videoId: v.youtube_id,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(startAt), end: v.end ? Math.ceil(v.end) : undefined, cc_load_policy: 0 },
          events: {
            onReady: () => { this.ready = true; this.loop(); },
            onStateChange: (e) => { this.playing = e.data === 1; if (e.data === 1) this.holdT = null; this.poll(); if (e.data === 1 && this.pendingPlay) this.pendingPlay = false; },
          },
        });
      }).catch(() => {
        // No API (blocked/offline): plain embed + full transcript so nothing is lost.
        this.box.innerHTML = `<iframe title="${window.RZ.esc(v.title || "")}" src="https://www.youtube.com/embed/${window.RZ.esc(v.youtube_id || "")}${startAt ? "?start=" + Math.floor(startAt) : ""}" allow="encrypted-media" allowfullscreen></iframe>`;
        this.toggleAll(true);
      });
    }

    poll() {
      if (!this.player || !this.player.getCurrentTime) { if (this.holdT != null) this.lastT = this.holdT; return; }
      // opened from a deep link: hold the transcript at that moment until the viewer first presses play
      this.lastT = this.holdT != null && !this.playing ? this.holdT : this.player.getCurrentTime() || 0;
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
      if (!this.turns.length) { this.hint.hidden = false; return; }
      let cur = -1;
      const anyShown = this.showAll || t >= (this.turns[0] ? this.turns[0].start : 0) - 0.05 && t > 0.2;
      this.hint.hidden = !!anyShown;
      this.rows.forEach((r, i) => {
        const { start, end } = r.tu;
        const text = r.tu.text || "";
        let n;
        if (this.showAll || t >= end || (i === this.linked && this.holdT != null && t >= start - 0.05)) n = text.length;   // a deep-linked turn reads in full while held
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
      // the turn to keep in view: the one being spoken, else the last one revealed (a pause between turns)
      let last = -1;
      if (!this.showAll) for (let i = 0; i < this.rows.length; i++) if (t >= this.rows[i].tu.start) last = i;
      const focus = cur >= 0 ? cur : last;
      if (focus !== this.focus) {
        this.focus = focus;
        if (focus >= 0) {
          const li = this.rows[focus].li;
          const top = li.offsetTop - this.list.offsetTop - 12;
          if (top < this.list.scrollTop || top + li.offsetHeight > this.list.scrollTop + this.list.clientHeight - 24) this.list.scrollTop = Math.max(0, top - 40);
        }
      }
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
      if (!play && this.holdT != null) this.holdT = t;
      if (!this.player || !this.player.seekTo) {
        if (this.html5 || !play) return;
        window.open(`https://www.youtube.com/watch?v=${this.v.youtube_id}&t=${Math.floor(t)}s`, "_blank", "noopener");
        return;
      }
      this.player.seekTo(t, true);
      this.lastT = t; this.lastPoll = performance.now();
      if (play) this.player.playVideo();
    }
    /** Deep link: mark turn i, reveal the transcript up to it, scroll the pane (not the page) so it is in view. */
    highlight(i) {
      const r = this.rows[i];
      if (!r) return;
      this.rows.forEach((x) => x.li.classList.remove("linked"));
      r.li.classList.add("linked");
      this.linked = i; r.shown = -2;
      if (this.holdT == null || this.holdT < r.tu.start) this.holdT = r.tu.start;
      this.lastT = this.holdT; this.lastPoll = performance.now();
      this.update(this.holdT + 0.01);
      const top = r.li.offsetTop - this.list.offsetTop - 12;
      const prev = this.list.style.scrollBehavior;
      this.list.style.scrollBehavior = "auto";
      this.list.scrollTop = Math.max(0, top - 4);
      this.list.style.scrollBehavior = prev;
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
      this.focus = undefined;
      if (this.showAll) this.list.scrollTop = 0;
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
