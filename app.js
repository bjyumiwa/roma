(() => {
  'use strict';

  const SLIDES = window.SLIDES || [];
  const $ = (id) => document.getElementById(id);
  const synth = window.speechSynthesis;

  // 読み上げ用の言い換え（画面表示はそのまま）
  const SAY = [
    [/^\(pause\)\s*/i, ''],
    [/ART 5\.0/g, 'Art five point oh'],
    [/CAPGAP/g, 'Cap Gap'],
    [/Sōshi/g, 'Soshi'],
    [/Shōnagon/g, 'Shonagon'],
  ];
  const PAUSE_MS = 1200;            // "(pause)" の間
  const STORE_KEY = 'viennaUkReader.v1';

  ensureImageDom();

  const el = {
    count: $('slideCount'), chip: $('slideChip'), title: $('slideTitle'),
    lineCount: $('lineCount'), pace: $('slidePace'), timer: $('timer'), paceFill: $('paceFill'),
    readAll: $('readAll'), stop: $('stop'), repeat: $('repeat'), autoNext: $('autoNext'), pauseEach: $('pauseEach'),
    voice: $('voice'), speed: $('speed'), voiceNotice: $('voiceNotice'), status: $('status'),
    showKana: $('showKana'), showJa: $('showJa'), memorize: $('memorize'),
    english: $('englishBlock'), kanaList: $('kanaList'), jaList: $('jaList'),
    kanaPanel: $('kanaPanel'), jaPanel: $('jaPanel'),
    prev: $('previous'), next: $('next'), jump: $('jump'), intro: $('intro'),
    showSlide: $('showSlide'), caption: $('slideCaption'), figure: $('slideFigure'), img: $('slideImg'), zoom: $('slideZoom'),
    lightbox: $('lightbox'), lbImg: $('lightboxImg'), lbCount: $('lbCount'),
    lbPrev: $('lbPrev'), lbNext: $('lbNext'), lbClose: $('lbClose'),
  };

  // 古い index.html を使っていても画像が出るよう、必要な要素がなければ作る
  function ensureImageDom() {
    if (!document.getElementById('slideFigure')) {
      const sec = document.querySelector('.slide-title') || document.querySelector('main');
      const fig = document.createElement('figure');
      fig.className = 'slide-figure'; fig.id = 'slideFigure';
      fig.innerHTML = '<button type="button" class="slide-img-btn" id="slideZoom" aria-label="スライド画像を拡大">'
        + '<img id="slideImg" alt="" width="1280" height="720" decoding="async"></button>'
        + '<figcaption id="slideCaption">タップで拡大・左右スワイプでスライド移動</figcaption>';
      if (sec) sec.prepend(fig);
    }
    if (!document.getElementById('lightbox')) {
      const dlg = document.createElement('dialog');
      dlg.id = 'lightbox'; dlg.className = 'lightbox';
      dlg.innerHTML = '<img id="lightboxImg" alt=""><div class="lightbox-bar">'
        + '<button type="button" id="lbPrev" class="secondary">←</button><span id="lbCount"></span>'
        + '<button type="button" id="lbNext" class="secondary">→</button>'
        + '<button type="button" id="lbClose" class="primary">閉じる</button></div>';
      document.body.append(dlg);
    }
    const fc = document.querySelector('#slideFigure figcaption');
    if (fc && !fc.id) fc.id = 'slideCaption';
  }

  // スライド画像：1ファイル版では window.SLIDE_IMAGES に埋め込み、通常版は slides/ フォルダ
  const imgSrc = (n) => (window.SLIDE_IMAGES && window.SLIDE_IMAGES[n]) || `slides/slide-${pad(n)}.jpg`;

  // ---------- 保存（使えない環境でも動くように） ----------
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } },
    save(obj) { try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* ignore */ } },
  };
  const saved = store.load();

  const state = {
    idx: clampIdx(hashIndex() ?? saved.idx ?? 0),
    runId: 0,          // 再生ごとに増やして、古い再生を無効にする
    playing: false,
    current: null,     // 再生中の utterance（GC対策で保持）
    waitTimers: new Set(),
    voices: [],
  };

  function clampIdx(i) { return Math.max(0, Math.min(SLIDES.length - 1, Number(i) || 0)); }
  function hashIndex() {
    const m = location.hash.match(/^#s(\d+)$/);
    return m ? Number(m[1]) - 1 : null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (sec) => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;

  function persist() {
    store.save({
      idx: state.idx, speed: el.speed.value, voice: el.voice.value,
      showSlide: el.showSlide ? el.showSlide.checked : true, showKana: el.showKana.checked, showJa: el.showJa.checked, memorize: el.memorize.checked,
      repeat: el.repeat.checked, autoNext: el.autoNext.checked, pauseEach: el.pauseEach.checked,
    });
  }

  // ---------- 描画 ----------
  function render() {
    const s = SLIDES[state.idx];
    const total = SLIDES.length;
    el.count.textContent = `${pad(state.idx + 1)} / ${pad(total)}`;
    el.chip.textContent = `SLIDE ${pad(s.n)}`;
    el.title.textContent = s.title;
    el.lineCount.textContent = `全${s.en.length}文`;
    el.pace.textContent = `発表目安${s.pace}秒`;
    el.intro.classList.toggle('hidden', state.idx !== 0);
    el.prev.disabled = state.idx === 0;
    el.next.disabled = state.idx === total - 1;
    el.jump.value = String(state.idx);
    document.title = `${pad(s.n)} ${s.title}｜Vienna UK Reader`;

    el.img.classList.remove('missing');
    if (el.caption) el.caption.textContent = 'タップで拡大・左右スワイプでスライド移動';
    el.img.src = imgSrc(s.n);
    el.img.alt = `スライド${s.n}: ${s.title}`;
    if (SLIDES[state.idx + 1]) { const pre = new Image(); pre.src = imgSrc(SLIDES[state.idx + 1].n); }
    if (el.lightbox.hasAttribute('open')) syncLightbox();

    // English: スライド内の英文を1つの段落にまとめる
    el.english.replaceChildren();
    s.en.forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sent';
      b.dataset.i = i;
      b.setAttribute('aria-label', `${i + 1}文目を再生: ${text.replace(/^\(pause\)\s*/i, '')}`);
      const sup = document.createElement('sup'); sup.textContent = i + 1; b.append(sup);
      let body = text;
      if (/^\(pause\)/i.test(body)) {
        const p = document.createElement('span'); p.className = 'pause-mark'; p.textContent = 'pause';
        b.append(p); body = body.replace(/^\(pause\)\s*/i, '');
      }
      b.append(document.createTextNode(body));
      el.english.append(b);
      if (i < s.en.length - 1) el.english.append(document.createTextNode(' '));
    });

    fillList(el.kanaList, s.kana, true);
    fillList(el.jaList, s.ja, false);
    resetTimer();
    applyView();
  }

  function fillList(ol, lines, kana) {
    ol.replaceChildren();
    lines.forEach((line, i) => {
      const li = document.createElement('li');
      li.dataset.i = i;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const span = document.createElement('span');
      if (kana) {
        line.split('／').forEach((part, k, arr) => {
          span.append(document.createTextNode(part));
          if (k < arr.length - 1) { const sl = document.createElement('span'); sl.className = 'slash'; sl.textContent = '／'; span.append(sl); }
        });
      } else {
        span.textContent = line;
      }
      li.append(span);
      ol.append(li);
    });
  }

  function syncLightbox() {
    const s = SLIDES[state.idx];
    el.lbImg.src = imgSrc(s.n);
    el.lbImg.alt = el.img.alt;
    el.lbCount.textContent = `${pad(state.idx + 1)} / ${pad(SLIDES.length)}`;
    el.lbPrev.disabled = state.idx === 0;
    el.lbNext.disabled = state.idx === SLIDES.length - 1;
  }

  // 左右スワイプでスライド移動
  function addSwipe(node) {
    let x0 = null, y0 = null, moved = false;
    node.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; moved = false; }, { passive: true });
    node.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0]; const dx = t.clientX - x0; const dy = t.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        moved = true; go(state.idx + (dx < 0 ? 1 : -1), { keepScroll: true });
      }
    }, { passive: true });
    node.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; } }, true);
  }

  function applyView() {
    el.figure.classList.toggle('hidden', !!el.showSlide && !el.showSlide.checked);
    el.kanaPanel.classList.toggle('hidden', !el.showKana.checked);
    el.jaPanel.classList.toggle('hidden', !el.showJa.checked);
    el.english.classList.toggle('memorize', el.memorize.checked);
  }

  function highlight(i) {
    document.querySelectorAll('.sent.active, .line-list li.active').forEach((n) => n.classList.remove('active'));
    if (i == null) return;
    const nodes = [
      el.english.querySelector(`.sent[data-i="${i}"]`),
      el.kanaList.querySelector(`li[data-i="${i}"]`),
      el.jaList.querySelector(`li[data-i="${i}"]`),
    ];
    nodes.forEach((n) => n && n.classList.add('active'));
    const target = nodes[0];
    if (target && state.playing) {
      const r = target.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 110) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function setStatus(msg) { el.status.textContent = msg; }

  // ---------- 声の選択 ----------
  const PREFERRED = /(Google UK English|Daniel|Serena|Kate|Arthur|Martha|Libby|Sonia|Ryan|Hazel|George|Susan|Oliver|Stephanie)/i;

  function loadVoices() {
    if (!synth) return;
    const all = synth.getVoices();
    if (!all.length) return;
    const gb = all.filter((v) => /^en[-_]GB/i.test(v.lang));
    const otherEn = all.filter((v) => /^en/i.test(v.lang) && !/^en[-_]GB/i.test(v.lang));
    state.voices = all;

    const keep = el.voice.value !== 'default' ? el.voice.value : saved.voice;
    el.voice.replaceChildren(new Option('端末へ英国英語を指定', 'default'));
    const addGroup = (label, list, flag) => {
      if (!list.length) return;
      const g = document.createElement('optgroup'); g.label = label;
      list.forEach((v) => g.append(new Option(`${flag} ${v.name}`, v.voiceURI)));
      el.voice.append(g);
    };
    addGroup('英国英語（en-GB）', gb, '🇬🇧');
    addGroup('その他の英語', otherEn, '·');

    const has = (uri) => all.some((v) => v.voiceURI === uri);
    if (keep && keep !== 'default' && has(keep)) {
      el.voice.value = keep;
    } else {
      const best = gb.find((v) => PREFERRED.test(v.name)) || gb.find((v) => v.localService) || gb[0];
      el.voice.value = best ? best.voiceURI : 'default';
    }

    if (gb.length) {
      el.voiceNotice.textContent = `英国英語の声が${gb.length}個見つかりました。`;
      el.voiceNotice.classList.remove('warn');
    } else {
      el.voiceNotice.textContent = 'この端末では英国英語の声が見つかりません。iPhoneは「設定 › アクセシビリティ › 読み上げコンテンツ › 声 › 英語」から英国英語の声を追加できます。';
      el.voiceNotice.classList.add('warn');
    }
  }

  function pickVoice() {
    const uri = el.voice.value;
    if (uri === 'default') return null;
    return state.voices.find((v) => v.voiceURI === uri) || null;
  }

  // ---------- 読み上げ ----------
  function wait(ms, run) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { state.waitTimers.delete(t); resolve(run === state.runId); }, ms);
      state.waitTimers.add(t);
    });
  }

  function speak(text, run) {
    return new Promise((resolve) => {
      if (!synth) { resolve({ ok: false, ms: 0 }); return; }
      const say = SAY.reduce((t, [re, rep]) => t.replace(re, rep), text).trim();
      const u = new SpeechSynthesisUtterance(say);
      const v = pickVoice();
      u.lang = 'en-GB';
      if (v) { try { u.voice = v; u.lang = v.lang; } catch { /* 声を指定できない環境では言語指定のみ */ } }
      u.rate = Number(el.speed.value) || 0.85;
      u.pitch = 1;
      const started = performance.now();
      let done = false;
      // onend が来ないブラウザ対策の保険
      const guard = setTimeout(() => finish(true), 4000 + (say.length * 130) / u.rate);
      function finish(ok) {
        if (done) return; done = true; clearTimeout(guard);
        resolve({ ok: ok && run === state.runId, ms: performance.now() - started });
      }
      u.onend = () => finish(true);
      u.onerror = (e) => finish(e.error === 'interrupted' || e.error === 'canceled' ? false : true);
      state.current = u;
      synth.speak(u);
    });
  }

  async function play(start = 0, single = false) {
    if (!synth) { setStatus('このブラウザは音声読み上げに対応していません。'); return; }
    stop(true);
    await new Promise((r) => setTimeout(r, 60)); // cancel直後のspeak取りこぼし対策
    const run = ++state.runId;
    state.playing = true;
    el.readAll.classList.add('playing');
    el.readAll.textContent = single ? '▶ 1文を再生中…' : '▶ 読み上げ中…';
    keepAwake(true);
    if (!single) startTimer();

    let loop = true;
    while (loop && run === state.runId) {
      const s = SLIDES[state.idx];
      const end = single ? start + 1 : s.en.length;
      for (let i = start; i < end; i++) {
        if (run !== state.runId) return;
        highlight(i);
        const text = s.en[i];
        setStatus(`${i + 1} / ${s.en.length} 文目`);
        if (/^\(pause\)/i.test(text)) {
          setStatus(`${i + 1} / ${s.en.length} 文目（間）`);
          if (!(await wait(PAUSE_MS, run))) return;
        }
        const r = await speak(text, run);
        if (run !== state.runId) return;
        if (el.pauseEach.checked && !single) {
          setStatus(`${i + 1} / ${s.en.length} 文目 — あなたの番です`);
          if (!(await wait(Math.max(1500, r.ms + 600), run))) return;
        }
      }
      if (single) break;
      if (el.repeat.checked) { start = 0; resetTimer(); startTimer(); continue; }
      if (el.autoNext.checked && state.idx < SLIDES.length - 1) {
        if (!(await wait(900, run))) return;
        go(state.idx + 1, { keepPlaying: true });
        start = 0; startTimer();
        continue;
      }
      loop = false;
    }
    if (run === state.runId) finishPlay(single ? '再生しました。' : 'このスライドを読み終えました。');
  }

  function finishPlay(msg) {
    state.playing = false;
    stopTimer();
    keepAwake(false);
    el.readAll.classList.remove('playing');
    el.readAll.textContent = '▶ このスライドを読み上げ';
    highlight(null);
    if (msg) setStatus(msg);
  }

  function stop(silent = false) {
    state.runId++;
    state.waitTimers.forEach(clearTimeout); state.waitTimers.clear();
    if (synth) synth.cancel();
    finishPlay(silent ? '' : '停止しました。');
  }

  // ---------- タイマー（読み上げ時間／自分で話す練習） ----------
  const timer = { start: 0, acc: 0, raf: 0, running: false };
  function tick() {
    const sec = (timer.acc + (timer.running ? performance.now() - timer.start : 0)) / 1000;
    el.timer.textContent = `⏱ ${fmt(sec)}`;
    const pace = SLIDES[state.idx].pace || 1;
    const pct = Math.min(100, (sec / pace) * 100);
    el.paceFill.style.width = `${pct}%`;
    el.paceFill.classList.toggle('over', sec > pace);
    if (timer.running) timer.raf = requestAnimationFrame(tick);
  }
  function startTimer() {
    if (timer.running) return;
    timer.running = true; timer.start = performance.now();
    el.timer.classList.add('running'); tick();
  }
  function stopTimer() {
    if (!timer.running) return;
    timer.acc += performance.now() - timer.start; timer.running = false;
    cancelAnimationFrame(timer.raf); el.timer.classList.remove('running'); tick();
  }
  function resetTimer() {
    cancelAnimationFrame(timer.raf);
    timer.running = false; timer.acc = 0;
    el.timer.classList.remove('running'); tick();
  }

  // ---------- 画面を消さない（対応端末のみ） ----------
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { wakeLock = null; }
  }

  // ---------- スライド移動 ----------
  function go(i, opts = {}) {
    const nextIdx = clampIdx(i);
    if (!opts.keepPlaying) stop(true);
    state.idx = nextIdx;
    try { history.replaceState(null, '', `#s${nextIdx + 1}`); } catch { /* file:// など */ }
    render();
    persist();
    if (!opts.keepPlaying && !opts.keepScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (!opts.keepPlaying) {
      setStatus('「読み上げ」で英国英語のお手本を聞けます。');
    }
  }

  // ---------- イベント ----------
  function init() {
    if (!SLIDES.length) { setStatus('data.js が読み込めませんでした。'); return; }

    SLIDES.forEach((s, i) => el.jump.append(new Option(`${pad(s.n)}  ${s.title}`, String(i))));

    // 保存済み設定を復元
    if (saved.speed) el.speed.value = saved.speed;
    for (const k of ['showKana', 'showJa', 'memorize', 'repeat', 'autoNext', 'pauseEach']) {
      if (typeof saved[k] === 'boolean') el[k].checked = saved[k];
    }

    el.readAll.addEventListener('click', () => (state.playing ? stop() : play(0)));
    el.stop.addEventListener('click', () => stop());
    el.prev.addEventListener('click', () => go(state.idx - 1));
    el.next.addEventListener('click', () => go(state.idx + 1));
    el.jump.addEventListener('change', () => go(Number(el.jump.value)));
    el.timer.addEventListener('click', () => {
      if (state.playing) return;
      if (timer.running) { stopTimer(); setStatus(`練習タイム ${el.timer.textContent.replace('⏱ ', '')}（目安${SLIDES[state.idx].pace}秒）`); }
      else { resetTimer(); startTimer(); setStatus('自分で話してみましょう。もう一度タップで停止。'); }
    });

    if (el.showSlide && typeof saved.showSlide === 'boolean') el.showSlide.checked = saved.showSlide;
    el.img.addEventListener('error', () => {
      el.img.classList.add('missing');
      if (el.caption) el.caption.textContent = '⚠ スライド画像を読み込めません。slides.js が同じ場所にあるか確認してください。';
    });
    el.zoom.addEventListener('click', () => {
      syncLightbox();
      if (typeof el.lightbox.showModal === 'function') el.lightbox.showModal(); else el.lightbox.setAttribute('open', '');
    });
    const closeLb = () => { if (typeof el.lightbox.close === 'function') el.lightbox.close(); else el.lightbox.removeAttribute('open'); };
    el.lbClose.addEventListener('click', closeLb);
    el.lbPrev.addEventListener('click', () => go(state.idx - 1, { keepScroll: true }));
    el.lbNext.addEventListener('click', () => go(state.idx + 1, { keepScroll: true }));
    el.lbImg.addEventListener('click', closeLb);
    addSwipe(el.zoom); addSwipe(el.lbImg);

    [el.showSlide, el.showKana, el.showJa, el.memorize].filter(Boolean).forEach((c) => c.addEventListener('change', () => {
      if (c === el.memorize) document.querySelectorAll('.sent.revealed').forEach((n) => n.classList.remove('revealed'));
      applyView(); persist();
    }));
    [el.repeat, el.autoNext, el.pauseEach, el.speed, el.voice].forEach((c) => c.addEventListener('change', persist));

    // 文をタップ → その1文だけ再生（暗記モードでは表示も）
    el.english.addEventListener('click', (e) => {
      const b = e.target.closest('.sent'); if (!b) return;
      if (el.memorize.checked) b.classList.add('revealed');
      play(Number(b.dataset.i), true);
    });
    const listHandler = (e) => {
      const li = e.target.closest('li'); if (!li) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      play(Number(li.dataset.i), true);
    };
    [el.kanaList, el.jaList].forEach((ol) => { ol.addEventListener('click', listHandler); ol.addEventListener('keydown', listHandler); });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (el.lightbox.hasAttribute('open') && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (tag === 'select' || tag === 'input' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(state.idx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.idx - 1); }
      else if (e.key === ' ' && tag !== 'button' && tag !== 'li') { e.preventDefault(); state.playing ? stop() : play(0); }
      else if (e.key === 'Escape') stop();
    });
    window.addEventListener('hashchange', () => { const h = hashIndex(); if (h != null && h !== state.idx) go(h); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && state.playing) stop(); });

    if (synth) {
      loadVoices();
      if ('onvoiceschanged' in synth) synth.addEventListener('voiceschanged', loadVoices);
      setTimeout(loadVoices, 500); // Safari は遅れて声が届くことがある
    } else {
      el.voiceNotice.textContent = 'このブラウザは音声読み上げ（Web Speech API）に対応していません。Safari / Chrome / Edge をお使いください。';
      el.voiceNotice.classList.add('warn');
      el.readAll.disabled = true;
    }

    render();

    // index.html に slides.js の読み込みがない場合は、ここで読み込む
    if (!window.SLIDE_IMAGES) {
      const sc = document.createElement('script');
      sc.src = 'slides.js?v=4';
      sc.onload = () => render();
      document.head.append(sc);
    }
  }

  init();
})();
