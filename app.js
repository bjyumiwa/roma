/* Vienna Speak Coach — vanilla JavaScript, no API keys or server required. */
'use strict';
(() => {
  const slides = window.VIENNA_SLIDES;
  if (!Array.isArray(slides) || !slides.length) return;
  const $ = (id) => document.getElementById(id);
  const storeKey = 'vienna-coach-settings-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch { saved = {}; }
  const completed = new Set(Array.isArray(saved.completed) ? saved.completed : []);
  let currentIndex = Math.min(slides.length - 1, Math.max(0, Number(saved.slide) || 0));
  let selectedLine = 0;
  let lines = [];
  let ttsToken = 0, ttsTimeout = null, audioIsSpeaking = false;
  let voices = [];
  const recordings = new Map(); // recordings only persist during this page session
  let recorder = null, recordingStream = null;
  let recognition = null, isRecognizing = false;
  let timerActive = false, startedAt = 0, elapsedBefore = 0, timerInterval = null, screenLock = null;
  const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const ASRClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  function save() {
    saved = {
      slide: currentIndex, completed: [...completed],
      kana: $('showKana').checked, japanese: $('showJapanese').checked,
      speed: Number($('speedRange').value), voice: $('voicePicker').value
    };
    try { localStorage.setItem(storeKey, JSON.stringify(saved)); } catch { /* private browsing */ }
  }
  function cleanForTTS(text) { return text.replace(/\(\s*pause\s*\)/gi,'').replace(/[—–]/g, ', ').trim(); }
  function formatTime(s) { return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; }
  function setStatus(elId, msg) { $(elId).textContent = msg; }

  function refreshProgress() {
    $('doneCount').textContent = `${completed.size} / ${slides.length} 練習済み`;
    $('progressFill').style.width = `${100 * completed.size / slides.length}%`;
    const done = completed.has(slides[currentIndex].number);
    $('completeBtn').textContent = done ? '✓ 練習済み（タップで解除）' : '□ このスライドを練習済みにする';
    $('completeBtn').classList.toggle('done',done);
  }
  function pickLine(n) {
    selectedLine = Math.max(0, Math.min(n,lines.length - 1));
    document.querySelectorAll('.line-card').forEach(el => {
      el.classList.toggle('selected',Number(el.dataset.line) === selectedLine);
    });
    $('transcriptArea').hidden = true;
    setStatus('recognitionStatus','');
  }
  function highlightSpeaking(n) {
    document.querySelectorAll('.line-card').forEach(el => {
      el.classList.toggle('speaking',Number(el.dataset.line) === n);
    });
  }
  function renderSlide() {
    const slide = slides[currentIndex];
    $('slidePicker').value = String(currentIndex);
    $('slideImage').src = slide.image;
    $('slideImage').alt = `スライド ${slide.number}：${slide.title}`;
    $('slideTitle').textContent = slide.title;
    $('slideNumber').textContent = `${String(slide.number).padStart(2,'0')} / ${slides.length}`;
    $('slidePace').textContent = `目安 ${slide.pace}秒`;
    $('prevBtn').disabled = currentIndex === 0;
    $('nextBtn').disabled = currentIndex === slides.length - 1;
    const container = $('scriptContent');
    container.replaceChildren();
    lines = [];
    slide.sections.forEach((part,sectionIdx) => {
      const section = document.createElement('div'); section.className='script-section';
      if (slide.sections.length > 1) {
        const label=document.createElement('div'); label.className='part-label';
        label.textContent=`PART ${sectionIdx + 1} / ${slide.sections.length}`;section.appendChild(label);
      }
      part.english.split('\n').map(x=>x.trim()).filter(Boolean).forEach(txt => {
        const index=lines.length;
        lines.push(txt);
        const row=document.createElement('div');row.className='line-card';row.dataset.line=String(index);
        row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','この英文を選ぶ: '+txt);
        const copy=document.createElement('span');copy.className='line-text';copy.textContent=txt;
        const listen=document.createElement('button');listen.className='line-play';listen.type='button';listen.textContent='▶';
        listen.setAttribute('aria-label','この英文を読み上げる');
        listen.addEventListener('click', e=>{e.stopPropagation();pickLine(index);speakLine(index);});
        row.addEventListener('click',()=>pickLine(index));
        row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===row){e.preventDefault();pickLine(index);}});
        row.append(copy,listen);section.appendChild(row);
      });
      [['kana','カタカナ発音','kana'],['japanese','日本語訳','japanese']].forEach(([field,name,style])=>{
        if (!part[field]) return;
        const block=document.createElement('div');block.className=`support-block ${style}`;
        block.dataset.support=field;
        const h=document.createElement('div');h.className='support-label';h.textContent=name;
        const val=document.createElement('div');val.className='support-text';val.textContent=part[field];
        block.append(h,val);section.appendChild(block);
      });
      container.appendChild(section);
    });
    selectedLine=0;
    if(lines.length) pickLine(0);
    toggleSupport();
    refreshProgress();
    refreshRecordingPlayback();
    setStatus('speechStatus','英語の文をタップすると、その1文を選べます。');
    save();
  }
  function toggleSupport() {
    document.querySelectorAll('[data-support="kana"]').forEach(e=>e.hidden=!$('showKana').checked);
    document.querySelectorAll('[data-support="japanese"]').forEach(e=>e.hidden=!$('showJapanese').checked);
  }
  function gotoSlide(n) {
    if(n < 0 || n >= slides.length || n === currentIndex) return;
    stopSpeak();stopRecognition();
    if(recorder && recorder.state === 'recording') stopRecording();
    currentIndex=n;renderSlide();
  }

  function populateVoices() {
    if (!hasTTS) return;
    const all=window.speechSynthesis.getVoices();
    if (!all.length) return;
    voices = all.filter(v=>/^en([-_]|$)/i.test(v.lang));
    voices.sort((a,b)=> (a.lang.startsWith('en-US') ? -1 : a.lang.startsWith('en-GB') ? 0 : 1) - (b.lang.startsWith('en-US') ? -1 : b.lang.startsWith('en-GB') ? 0 : 1));
    const select=$('voicePicker'), before=select.value || saved.voice || '';
    select.replaceChildren();
    const blank=document.createElement('option');blank.value='';blank.textContent='端末の英語音声を使用';select.appendChild(blank);
    voices.forEach((v,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${v.name} (${v.lang})`;select.appendChild(o);});
    if(before!=='' && voices[Number(before)]) select.value=before;
    else if(voices.length) select.value='0';
  }
  function stopSpeak() {
    ttsToken++;
    if(ttsTimeout){clearTimeout(ttsTimeout);ttsTimeout=null;}
    if(hasTTS) try{window.speechSynthesis.cancel();}catch{}
    audioIsSpeaking=false;
    highlightSpeaking(-1);
  }
  function selectedVoice(){const id=$('voicePicker').value;return id===''?null:(voices[Number(id)] || null);}
  function speakQueue(queue) {
    if(!hasTTS){setStatus('speechStatus','このブラウザーでは読み上げに対応していません。Android版Chromeを試してください。');return;}
    stopSpeak();stopRecognition();
    const token=ttsToken;
    const todo=queue.filter(x=>cleanForTTS(x.text));
    if(!todo.length)return;
    audioIsSpeaking=true;
    let i=0;
    const next=()=>{
      if(token!==ttsToken)return;
      if(i>=todo.length){audioIsSpeaking=false;highlightSpeaking(-1);setStatus('speechStatus','再生が終わりました。');return;}
      const item=todo[i];i++;
      highlightSpeaking(item.index);
      setStatus('speechStatus',`読み上げ中：${i} / ${todo.length} 文`);
      const utterance=new SpeechSynthesisUtterance(cleanForTTS(item.text));
      utterance.lang='en-US';utterance.rate=Number($('speedRange').value)||0.85;utterance.pitch=1;
      const voice=selectedVoice();if(voice){utterance.voice=voice;utterance.lang=voice.lang;}
      utterance.onend=()=>{if(token===ttsToken)ttsTimeout=setTimeout(next,220);};
      utterance.onerror=event=>{
        if(token!==ttsToken)return;
        if(event.error === 'canceled'||event.error === 'interrupted')return;
        setStatus('speechStatus','音声再生が停止しました。端末の英語音声設定も確認してください。');
        audioIsSpeaking=false;highlightSpeaking(-1);
      };
      try {window.speechSynthesis.speak(utterance);}catch{setStatus('speechStatus','読み上げを開始できませんでした。');}
    };
    next();
  }
  function speakLine(index){if(!lines.length)return;speakQueue([{index,text:lines[index]}]);}
  function speakAll(){speakQueue(lines.map((text,index)=>({text,index})));}

  function stopRecognition(){
    if(recognition){try{recognition.abort();}catch{}recognition=null;}
    isRecognizing=false;$('recognizeBtn').textContent='🎙 選んだ英文を音声認識';
  }
  function beginRecognition(){
    if(!ASRClass){setStatus('recognitionStatus','この端末では音声認識が利用できません。録音練習はできます。');return;}
    if(isRecognizing){stopRecognition();setStatus('recognitionStatus','音声認識を停止しました。');return;}
    if(recorder && recorder.state==='recording') stopRecording();
    stopSpeak();stopRecognition();
    const target=lines[selectedLine]||'';
    const rec=new ASRClass();recognition=rec;isRecognizing=true;
    rec.lang='en-US';rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=1;
    $('recognizeBtn').textContent='■ 音声認識を停止';
    $('transcriptArea').hidden=false;$('targetText').textContent=target;$('transcriptText').textContent='…';
    setStatus('recognitionStatus','英語で、選んだ1文を話してください。');
    rec.onresult=e=>{
      const words=[...e.results].map(r=>r[0]?.transcript||'').join(' ').trim();
      $('transcriptText').textContent=words||'…';
      if([...e.results].some(r=>r.isFinal))setStatus('recognitionStatus','音声認識が終わりました。原稿と見比べてください。');
    };
    rec.onerror=e=>{
      const msg=e.error==='not-allowed'?'マイクの使用が許可されていません。':e.error==='network'?'音声認識にはネット接続が必要な場合があります。':`音声認識を利用できませんでした（${e.error}）。`;
      setStatus('recognitionStatus',msg);
    };
    rec.onend=()=>{isRecognizing=false;recognition=null;$('recognizeBtn').textContent='🎙 選んだ英文を音声認識';};
    try{rec.start();}catch{stopRecognition();setStatus('recognitionStatus','音声認識を開始できませんでした。');}
  }
  function refreshRecordingPlayback(){
    const item=recordings.get(slides[currentIndex].number);
    $('playbackArea').hidden=!item;
    const audio=$('recordedAudio');
    if(item){audio.src=item.url;$('downloadAudio').href=item.url;$('downloadAudio').download=`Vienna_slide_${String(slides[currentIndex].number).padStart(2,'0')}.${item.ext}`;}
    else{audio.removeAttribute('src');audio.load();}
  }
  async function startRecording(){
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){setStatus('recordStatus','録音に対応していないブラウザーです。Android版ChromeとHTTPSを使ってください。');return;}
    stopSpeak();stopRecognition();
    const slideNumber=slides[currentIndex].number;
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
    catch(e){setStatus('recordStatus','マイクを使用できません。Chromeのサイト設定でマイクを許可してください。');return;}
    recordingStream=stream;
    const options=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x));
    let localRecorder;
    try{localRecorder=new MediaRecorder(stream,options?{mimeType:options}:undefined);}
    catch{stream.getTracks().forEach(t=>t.stop());setStatus('recordStatus','この端末では録音形式を利用できませんでした。');return;}
    recorder=localRecorder;
    const chunks=[];
    localRecorder.ondataavailable=e=>{if(e.data && e.data.size)chunks.push(e.data);};
    localRecorder.onerror=()=>{setStatus('recordStatus','録音中にエラーが発生しました。');};
    localRecorder.onstop=()=>{
      const mime=localRecorder.mimeType || options || 'audio/webm';
      if(chunks.length){
        const blob=new Blob(chunks,{type:mime});
        const previous=recordings.get(slideNumber);
        if(previous)URL.revokeObjectURL(previous.url);
        const url=URL.createObjectURL(blob);
        recordings.set(slideNumber,{url,ext:mime.includes('mp4')?'m4a':'webm'});
        if(slides[currentIndex].number===slideNumber){refreshRecordingPlayback();setStatus('recordStatus','録音完了。再生して聞き返せます。');}
      }else setStatus('recordStatus','録音データがありませんでした。もう一度試してください。');
      stream.getTracks().forEach(t=>t.stop());
      if(recordingStream===stream)recordingStream=null;
      if(recorder===localRecorder)recorder=null;
    };
    try{localRecorder.start(200);}
    catch{stream.getTracks().forEach(t=>t.stop());recorder=null;setStatus('recordStatus','録音を開始できませんでした。');return;}
    $('recordBtn').disabled=true;$('recordStopBtn').disabled=false;$('recordBtn').classList.add('recording');
    setStatus('recordStatus',`録音中… スライド ${slideNumber}。話し終えたら「録音終了」を押してください。`);
  }
  function stopRecording(){
    if(recorder&&recorder.state==='recording')try{recorder.stop();}catch{}
    $('recordBtn').disabled=false;$('recordStopBtn').disabled=true;$('recordBtn').classList.remove('recording');
  }

  function currentElapsed(){return Math.floor(elapsedBefore+(timerActive?(Date.now()-startedAt)/1000:0));}
  function updateTimer(){
    const seconds=currentElapsed();$('timerText').textContent=formatTime(seconds);
    $('timerFill').style.width=`${Math.min(seconds/1500,1)*100}%`;
    const info=$('timerInfo');
    info.textContent=seconds>1500?'25分を超えています。録画規定を確認してください。':seconds>600?'10分を超えました。録画時間の下限を満たしています。':timerActive?'計測中。10分を超えるまで続けましょう。':'全スライドを自分で話す時間を計測します。';
    info.style.color=seconds>1500?'#b83c51':seconds>600?'#0b8179':'';
  }
  async function requestWakeLock(){try{if('wakeLock' in navigator)screenLock=await navigator.wakeLock.request('screen');}catch{}}
  function toggleTimer(){
    if(timerActive){elapsedBefore+=(Date.now()-startedAt)/1000;timerActive=false;clearInterval(timerInterval);timerInterval=null;$('timerStartBtn').textContent='▶ 再開';if(screenLock){screenLock.release().catch(()=>{});screenLock=null;}}
    else{timerActive=true;startedAt=Date.now();timerInterval=setInterval(updateTimer,300);$('timerStartBtn').textContent='■ 一時停止';requestWakeLock();}
    updateTimer();
  }
  function resetTimer(){
    if(timerActive)toggleTimer();elapsedBefore=0;$('timerStartBtn').textContent='▶ 開始';updateTimer();
  }

  slides.forEach((s,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=`${i+1}. ${s.title.slice(0,30)}`;$('slidePicker').appendChild(opt);});
  $('showKana').checked=saved.kana!==false;
  $('showJapanese').checked=saved.japanese!==false;
  $('speedRange').value=Number.isFinite(Number(saved.speed))&&saved.speed?String(saved.speed):'0.85';
  $('speedText').textContent=`${Number($('speedRange').value).toFixed(2)}×`;
  $('slidePicker').addEventListener('change', e=>gotoSlide(Number(e.target.value)));
  $('prevBtn').addEventListener('click',()=>gotoSlide(currentIndex-1));
  $('nextBtn').addEventListener('click',()=>gotoSlide(currentIndex+1));
  $('completeBtn').addEventListener('click',()=>{
    const n=slides[currentIndex].number;completed.has(n)?completed.delete(n):completed.add(n);refreshProgress();save();
  });
  $('showKana').addEventListener('change',()=>{toggleSupport();save();});
  $('showJapanese').addEventListener('change',()=>{toggleSupport();save();});
  $('speedRange').addEventListener('input',()=>{$('speedText').textContent=`${Number($('speedRange').value).toFixed(2)}×`;save();});
  $('voicePicker').addEventListener('change',save);
  $('playAllBtn').addEventListener('click',speakAll);
  $('playLineBtn').addEventListener('click',()=>speakLine(selectedLine));
  $('stopSpeakBtn').addEventListener('click',()=>{stopSpeak();setStatus('speechStatus','再生を停止しました。');});
  $('recordBtn').addEventListener('click',startRecording);
  $('recordStopBtn').addEventListener('click',stopRecording);
  $('recognizeBtn').addEventListener('click',beginRecognition);
  $('timerStartBtn').addEventListener('click',toggleTimer);
  $('timerResetBtn').addEventListener('click',resetTimer);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&timerActive)requestWakeLock();});
  if(!ASRClass){setStatus('recognitionStatus','このブラウザーでは音声認識非対応です。録音練習は利用できます。');$('recognizeBtn').disabled=true;}
  if(!hasTTS){setStatus('speechStatus','音声読み上げは、このブラウザーでは利用できません。');$('playAllBtn').disabled=true;$('playLineBtn').disabled=true;}
  else{populateVoices();window.speechSynthesis.addEventListener?.('voiceschanged',populateVoices);}
  renderSlide();updateTimer();
  if('serviceWorker' in navigator && window.isSecureContext)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
  let installPrompt=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false;});
  $('installBtn').addEventListener('click',async()=>{
    if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true;
  });
  window.addEventListener('pagehide',()=>{
    stopSpeak();stopRecognition();
    if(recorder&&recorder.state==='recording')stopRecording();
    if(recordingStream)recordingStream.getTracks().forEach(t=>t.stop());
  });
})();
