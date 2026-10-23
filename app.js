'use strict';
(() => {
  const slides = window.VIENNA_SLIDES || [];
  const images = window.VIENNA_IMAGES || [];
  const $ = id => document.getElementById(id);
  if (!slides.length) {
    const s=$('status'); if(s) s.textContent='原稿データが読み込まれていません。data.js を確認してください。';
    return;
  }
  const synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;
  let index = 0;
  let availableVoices = [];
  let runToken = 0;
  let reading = false;
  let currentLine = -1;
  let pendingWait = null;
  let timerStart = 0;
  let timerAccum = 0;
  let timerInterval = null;
  let swipingX = null;

  function fmt(n) {return String(n).padStart(2,'0');}
  function text(id,value) {$(id).textContent = value;}
  function safeStore(key,value) {try{localStorage.setItem('vienna5_'+key,String(value));}catch{}}
  function safeLoad(key) {try{return localStorage.getItem('vienna5_'+key);}catch{return null;}}
  function updateButtonState() {
    $('readAll').textContent=reading?'▶ 読み上げ中…':'▶ このスライドを読み上げ';
    const els = document.querySelectorAll('.en-line');
    els.forEach((el,i)=>{el.classList.toggle('active',reading && i===currentLine);el.setAttribute('aria-pressed',String(reading && i===currentLine));});
  }
  function stopSpeaking(statusMessage) {
    runToken++;
    reading=false;
    currentLine=-1;
    if(pendingWait!==null){clearTimeout(pendingWait);pendingWait=null;}
    if(synth){try{synth.cancel();}catch{}}
    updateButtonState();
    if(statusMessage) text('status',statusMessage);
  }
  function applyDisplaySettings() {
    $('slideFigure').classList.toggle('hidden',!$('showSlide').checked);
    $('kanaPanel').classList.toggle('hidden',!$('showKana').checked);
    $('jaPanel').classList.toggle('hidden',!$('showJa').checked);
    $('englishBlock').classList.toggle('memorize',$('memorize').checked);
  }
  function stopTimer(){
    if(timerInterval!==null){clearInterval(timerInterval);timerInterval=null;timerAccum+=performance.now()-timerStart;}
    $('timer').classList.remove('running');
  }
  function resetTimer(){stopTimer();timerAccum=0;updateTimerLabel();}
  function updateTimerLabel(){
    const passed=timerAccum+(timerInterval!==null?performance.now()-timerStart:0);
    const ss=Math.max(0,Math.floor(passed/1000));
    text('timer','⏱ '+Math.floor(ss/60)+':'+String(ss%60).padStart(2,'0'));
    const target=slides[index].pace*1000;
    $('paceFill').style.width=Math.min(100,passed/target*100)+'%';
  }
  function toggleTimer(){
    if(timerInterval!==null){stopTimer();updateTimerLabel();text('status','ストップウォッチを停止しました。');}
    else{timerStart=performance.now();timerInterval=setInterval(updateTimerLabel,120);$('timer').classList.add('running');text('status','ご自身の声で練習中です。');}
  }
  function fillLines() {
    const source=slides[index].lines;
    const english=$('englishBlock');
    const kana=$('kanaList');
    const ja=$('jaList');
    english.replaceChildren();kana.replaceChildren();ja.replaceChildren();
    source.forEach((line,i)=>{
      const item=document.createElement('button');
      item.type='button';item.className='en-line';
      item.textContent=line.en;
      item.title='この1文だけ英国英語で再生';
      item.setAttribute('aria-label',`第${i+1}文を再生: ${line.en}`);
      item.addEventListener('click',()=>speakLines(index,i,i));
      english.appendChild(item);
      const k=document.createElement('li');k.textContent=line.kana;kana.appendChild(k);
      const j=document.createElement('li');j.textContent=line.ja;ja.appendChild(j);
    });
  }
  function showSlide(newIndex,{preserveAudio=false}={}) {
    if(newIndex<0 || newIndex>=slides.length)return;
    if(!preserveAudio)stopSpeaking();
    index=newIndex;
    resetTimer();
    const slide=slides[index];
    text('slideCount',fmt(index+1)+' / '+fmt(slides.length));
    text('slideChip','SLIDE '+fmt(index+1));
    text('slideTitle',slide.title);
    text('lineCount','全'+slide.lines.length+'文');
    text('slidePace','発表目安'+slide.pace+'秒');
    $('slideImg').src=images[index];
    $('slideImg').alt=`スライド${index+1}: ${slide.title}`;
    $('lightboxImg').src=images[index];
    $('lightboxImg').alt=`拡大したスライド${index+1}: ${slide.title}`;
    text('lbCount',fmt(index+1)+' / '+fmt(slides.length));
    $('previous').disabled=index===0;
    $('next').disabled=index===slides.length-1;
    $('jump').value=String(index);
    fillLines();applyDisplaySettings();updateButtonState();
    safeStore('slide',index);
    if(!preserveAudio)text('status',`${index+1}枚目を表示中。「読み上げ」で英語を練習できます。`);
  }
  function updateVoices(){
    if(!synth)return;
    availableVoices=synth.getVoices()||[];
    const gb=availableVoices.filter(v=>(v.lang||'').toLowerCase().replace('_','-').startsWith('en-gb'));
    const sel=$('voice');const preferred=safeLoad('voice')||sel.value||'default';
    sel.replaceChildren();
    const opt=document.createElement('option');opt.value='default';opt.textContent='端末に英国英語を指定';sel.appendChild(opt);
    gb.forEach(v=>{const o=document.createElement('option');o.value=v.voiceURI||v.name;o.textContent=v.name+(v.localService?'（端末）':'');sel.appendChild(o);});
    if(Array.from(sel.options).some(o=>o.value===preferred))sel.value=preferred;
    if(gb.length){text('voiceNotice',`英国英語の音声 ${gb.length} 種類を検出しました。声を選んで練習できます。`);}
    else {text('voiceNotice','英国英語の声を検出できませんでした。端末に英語（英国）音声を追加すると改善する場合があります。');}
  }
  function pickVoice(){
    const choice=$('voice').value;
    const gb=availableVoices.filter(v=>(v.lang||'').toLowerCase().replace('_','-').startsWith('en-gb'));
    if(choice!=='default')return availableVoices.find(v=>(v.voiceURI||v.name)===choice)||gb[0]||null;
    return gb.find(v=>v.localService)||gb[0]||null;
  }
  function delayMs(ms,token){
    return new Promise(resolve=>{
      if(token!==runToken)return resolve(false);
      pendingWait=setTimeout(()=>{pendingWait=null;resolve(token===runToken);},ms);
    });
  }
  function speakOne(line,token){
    return new Promise(resolve=>{
      if(!synth || token!==runToken)return resolve(false);
      const utter=new SpeechSynthesisUtterance(line);
      utter.lang='en-GB';utter.rate=Number($('speed').value)||.85;
      utter.pitch=1.0;
      const voice=pickVoice();if(voice)utter.voice=voice;
      let settled=false;
      function done(success){if(settled)return;settled=true;resolve(Boolean(success && token===runToken));}
      utter.onend=()=>done(true);
      utter.onerror=()=>done(false);
      try{synth.speak(utter);}catch{done(false);}
    });
  }
  async function speakLines(slideIndex,first=0,last=null){
    if(!synth){text('status','このブラウザは読み上げに対応していません。Chrome / Edge / Safariをお試しください。');return;}
    stopSpeaking();
    const token=runToken;
    reading=true;
    const whole=last===null;
    const target=slides[slideIndex];
    const end=whole?target.lines.length-1:last;
    text('status',whole?`スライド${slideIndex+1}を読み上げています。`:`${first+1}文目を読み上げています。`);
    for(let j=first;j<=end;j++){
      if(token!==runToken)return;
      currentLine=j;
      updateButtonState();
      const ok=await speakOne(target.lines[j].en,token);
      if(token!==runToken)return;
      if(!ok){stopSpeaking('音声再生が中断されました。別の声を選ぶか、もう一度タップしてください。');return;}
      if(j!==end && $('pauseEach').checked){const continued=await delayMs(900,token);if(!continued)return;}
    }
    if(token!==runToken)return;
    if(whole && $('repeat').checked){
      const continued=await delayMs(1000,token);if(continued)speakLines(slideIndex);return;
    }
    if(whole && $('autoNext').checked && slideIndex<slides.length-1){
      const continued=await delayMs(1000,token);if(!continued)return;
      // Keep user settings, replace the displayed slide, then play it.
      showSlide(slideIndex+1,{preserveAudio:true});
      speakLines(slideIndex+1);return;
    }
    reading=false;currentLine=-1;updateButtonState();
    text('status',whole?`スライド${slideIndex+1}の読み上げが終わりました。`:'1文の読み上げが終わりました。');
  }
  function jumpBy(delta){showSlide(index+delta);}
  function openZoom(){
    const dlg=$('lightbox');
    try{dlg.showModal();}catch{dlg.setAttribute('open','');}
  }
  function closeZoom(){const dlg=$('lightbox');if(typeof dlg.close==='function')dlg.close();else dlg.removeAttribute('open');}
  function setSwipe(el,handler){
    el.addEventListener('touchstart',e=>{swipingX=e.changedTouches[0]?.clientX??null;},{passive:true});
    el.addEventListener('touchend',e=>{
      if(swipingX===null)return;
      const diff=(e.changedTouches[0]?.clientX??swipingX)-swipingX;
      swipingX=null;
      if(Math.abs(diff)>60)handler(diff>0?-1:1);
    },{passive:true});
  }
  function initialize(){
    $('jump').replaceChildren();
    slides.forEach((s,i)=>{const op=document.createElement('option');op.value=String(i);op.textContent=`${fmt(i+1)}　${s.title}`;$('jump').appendChild(op);});
    const prev=Number(safeLoad('slide'));
    showSlide(Number.isInteger(prev)&&prev>=0&&prev<slides.length?prev:0);
    ['showSlide','showKana','showJa','memorize','repeat','autoNext','pauseEach'].forEach(id=>{
      const stored=safeLoad(id);
      if(stored!==null)$(id).checked=stored==='true';
      $(id).addEventListener('change',()=>{safeStore(id,$(id).checked);applyDisplaySettings();});
    });
    const storedSpeed=safeLoad('speed');if(storedSpeed&&Array.from($('speed').options).some(o=>o.value===storedSpeed))$('speed').value=storedSpeed;
    $('speed').addEventListener('change',()=>safeStore('speed',$('speed').value));
    $('voice').addEventListener('change',()=>safeStore('voice',$('voice').value));
    $('readAll').addEventListener('click',()=>speakLines(index));
    $('stop').addEventListener('click',()=>stopSpeaking('停止しました。'));
    $('previous').addEventListener('click',()=>jumpBy(-1));
    $('next').addEventListener('click',()=>jumpBy(1));
    $('jump').addEventListener('change',()=>showSlide(Number($('jump').value)));
    $('timer').addEventListener('click',toggleTimer);
    $('slideZoom').addEventListener('click',openZoom);
    $('lbClose').addEventListener('click',closeZoom);
    $('lbPrev').addEventListener('click',()=>jumpBy(-1));
    $('lbNext').addEventListener('click',()=>jumpBy(1));
    setSwipe($('slideFigure'),jumpBy);
    setSwipe($('lightboxImg'),jumpBy);
    document.addEventListener('keydown',e=>{
      const active=document.activeElement;
      if(['INPUT','SELECT','TEXTAREA'].includes(active?.tagName))return;
      if(e.key==='ArrowLeft'){e.preventDefault();jumpBy(-1);}
      else if(e.key==='ArrowRight'){e.preventDefault();jumpBy(1);}
      else if(e.code==='Space' && !['BUTTON'].includes(active?.tagName)){
        e.preventDefault();if(reading)stopSpeaking('停止しました。');else speakLines(index);
      }
    });
    if(synth){
      updateVoices();
      if(typeof synth.addEventListener==='function')synth.addEventListener('voiceschanged',updateVoices);
      else synth.onvoiceschanged=updateVoices;
    }else{ text('voiceNotice','このブラウザはSpeech Synthesis APIに対応していません。'); }
    applyDisplaySettings();
  }
  initialize();
})();
