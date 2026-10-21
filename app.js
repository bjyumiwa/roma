/* Vienna UK Reader – English UK TTS and 16 slides; no microphones or servers. */
(() => {
  'use strict';
  const slides = window.VIENNA_READER_SLIDES;
  if (!Array.isArray(slides) || !slides.length) return;
  const $ = id => document.getElementById(id);
  const speechAvailable = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  const storeKey = 'vienna-uk-reader-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storeKey) || '{}'); } catch { saved = {}; }
  let current = Math.max(0, Math.min(slides.length - 1, Number(saved.slide) || 0));
  let voices = [];
  let readingToken = 0;
  let waitTimeout = null;
  const save = () => {
    try { localStorage.setItem(storeKey, JSON.stringify({ slide: current, speed: $('speed').value, voice: $('voice').value })); } catch { /* optional */ }
  };
  const status = t => { $('status').textContent = t; };
  function stop() {
    readingToken++;
    if (waitTimeout !== null) { clearTimeout(waitTimeout); waitTimeout = null; }
    if (speechAvailable) window.speechSynthesis.cancel();
    document.querySelectorAll('.sentence').forEach(el => el.classList.remove('speaking'));
  }
  function availableVoices() {
    if (!speechAvailable) { $('voiceNotice').textContent = 'このブラウザは音声読み上げに対応していません。'; $('voiceNotice').classList.add('warning'); return; }
    voices = window.speechSynthesis.getVoices().filter(v => /^en[-_]GB$/i.test(v.lang));
    const previous = $('voice').value;
    $('voice').replaceChildren();
    const fallback = new Option('端末へ英国英語を指定', 'default');
    $('voice').add(fallback);
    voices.forEach((v, i) => $('voice').add(new Option(v.name + '（en-GB）', String(i))));
    let choice = saved.voice !== undefined ? String(saved.voice) : previous;
    if (!Array.from($('voice').options).some(o => o.value === choice)) choice = voices.length ? '0' : 'default';
    if (choice === 'default' && voices.length) choice = '0';
    $('voice').value = choice;
    if (voices.length) {
      $('voiceNotice').textContent = '英国英語（en-GB）の声が利用できます。' + (voices.length > 1 ? '声の種類を選べます。' : '');
      $('voiceNotice').classList.remove('warning');
    } else {
      $('voiceNotice').textContent = '英国英語の声が検出されません。Androidの音声読み上げ設定で English (United Kingdom) を追加してください。「端末へ英国英語を指定」は端末によって別のアクセントになることがあります。';
      $('voiceNotice').classList.add('warning');
    }
  }
  function cleanText(t) { return t.replace(/\(pause\)/gi, '').replace(/[—–]/g, ', ').replace(/\bAI-image\b/g,'AI image'); }
  function speakLine(index, token) {
    if (token !== readingToken || !speechAvailable) return;
    const lines = slides[current].lines;
    if (index >= lines.length) { status('このスライドの読み上げが終わりました。'); document.querySelectorAll('.sentence').forEach(e=>e.classList.remove('speaking')); return; }
    document.querySelectorAll('.sentence').forEach((e, n)=>e.classList.toggle('speaking', n === index));
    const entry = document.querySelectorAll('.sentence')[index];
    if (entry && index > 0) entry.scrollIntoView({ behavior:'smooth', block:'nearest' });
    const utterance = new SpeechSynthesisUtterance(cleanText(lines[index].english));
    utterance.lang = 'en-GB';
    utterance.rate = Number($('speed').value) || 0.85;
    utterance.pitch = 1;
    const voice = voices[Number($('voice').value)];
    if ($('voice').value !== 'default' && voice) utterance.voice = voice;
    utterance.onend = () => {
      if (token !== readingToken) return;
      if (index + 1 < lines.length) { waitTimeout = setTimeout(() => { waitTimeout = null; speakLine(index + 1, token); }, 380); }
      else { status('このスライドの読み上げが終わりました。'); document.querySelectorAll('.sentence').forEach(e => e.classList.remove('speaking')); }
    };
    utterance.onerror = evt => { if (token === readingToken && evt.error !== 'interrupted' && evt.error !== 'canceled') { status('再生できませんでした。端末の音声読み上げ設定をご確認ください。'); document.querySelectorAll('.sentence').forEach(e => e.classList.remove('speaking')); } };
    status(`${index + 1} / ${lines.length} 文を読み上げています…`);
    window.speechSynthesis.speak(utterance);
  }
  function readFrom(index, all) {
    if (!speechAvailable) { status('このブラウザには読み上げ機能がありません。AndroidのChromeをお試しください。'); return; }
    stop();
    if ($('voice').value === 'default' && voices.length === 0) status('端末にen-GBを指定して再生します。声のアクセントは端末の設定によります。');
    const token = readingToken;
    if (all) speakLine(index, token);
    else {
      const utterance = new SpeechSynthesisUtterance(cleanText(slides[current].lines[index].english));
      utterance.lang='en-GB'; utterance.rate=Number($('speed').value) || 0.85;
      const v=voices[Number($('voice').value)]; if($('voice').value !== 'default' && v) utterance.voice=v;
      document.querySelectorAll('.sentence').forEach((e,n)=>e.classList.toggle('speaking',n===index));
      status(`${index + 1}番の英文を読み上げています…`);
      utterance.onend=()=>{if(token===readingToken){status('1文の読み上げが終わりました。');document.querySelectorAll('.sentence').forEach(e=>e.classList.remove('speaking'));}};
      utterance.onerror=()=>{if(token===readingToken)status('再生できませんでした。端末の音声設定をご確認ください。');};
      window.speechSynthesis.speak(utterance);
    }
  }
  function draw() {
    stop();
    const slide = slides[current];
    $('slideCount').textContent = `${String(slide.number).padStart(2,'0')} / ${slides.length}`;
    $('slideChip').textContent = 'SLIDE ' + String(slide.number).padStart(2,'0');
    $('slideTitle').textContent = slide.title;
    $('lineCount').textContent = `全${slide.lines.length}文`;
    $('slidePace').textContent = `発表目安 ${slide.pace}秒`;
    $('jump').value = String(current);
    $('previous').disabled = current === 0;
    $('next').disabled = current === slides.length-1;
    const content = $('sentences');content.replaceChildren();
    slide.lines.forEach((line,i) => {
      const card = document.createElement('article');card.className='sentence';
      const head=document.createElement('div');head.className='sentence-top';
      const main=document.createElement('div');main.style.minWidth='0';
      const num=document.createElement('span');num.className='sentence-num';num.textContent='SENTENCE ' + String(i+1).padStart(2,'0');
      const en=document.createElement('p');en.className='english';en.textContent=line.english;
      main.append(num,en);
      const play=document.createElement('button');play.type='button';play.className='line-play';play.textContent='▶';play.setAttribute('aria-label',`${i+1}番の英文を聞く`);play.addEventListener('click',()=>readFrom(i,false));
      head.append(main,play);
      const kanaBlock=document.createElement('div');kanaBlock.className='kana-block';
      const klabel=document.createElement('span');klabel.className='tag';klabel.textContent='UK発音に近いカタカナ';
      const kana=document.createElement('p');kana.className='kana';kana.textContent=line.kana;
      kanaBlock.append(klabel,kana);
      const jaBlock=document.createElement('div');jaBlock.className='japanese-block';
      const jlabel=document.createElement('span');jlabel.className='tag';jlabel.textContent='日本語訳';
      const ja=document.createElement('p');ja.className='japanese';ja.textContent=line.japanese;
      jaBlock.append(jlabel,ja);card.append(head,kanaBlock,jaBlock);content.append(card);
    });
    save();status('「読み上げ」で英国英語のお手本を聞けます。');
  }
  function go(i) { if (i<0 || i>=slides.length || i===current) return; current=i; draw(); window.scrollTo(0, 0); }
  slides.forEach((s,i)=>$('jump').add(new Option(`スライド ${s.number}`,String(i))));
  $('speed').value = ['0.75','0.85','1','1.1'].includes(String(saved.speed)) ? String(saved.speed) : '0.85';
  $('previous').addEventListener('click',()=>go(current-1));
  $('next').addEventListener('click',()=>go(current+1));
  $('jump').addEventListener('change',()=>go(Number($('jump').value)));
  $('readAll').addEventListener('click',()=>readFrom(0,true));
  $('stop').addEventListener('click',()=>{stop();status('読み上げを停止しました。');});
  $('speed').addEventListener('change',save);
  $('voice').addEventListener('change',save);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',stop);
  if(speechAvailable){availableVoices();window.speechSynthesis.addEventListener('voiceschanged', availableVoices);}
  else availableVoices();
  draw();
  if ('serviceWorker' in navigator && window.location.protocol === 'https:') navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
})();
