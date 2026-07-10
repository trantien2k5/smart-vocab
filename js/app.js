const DB_KEY='vsprout_words_v1', SET_KEY='vsprout_settings_v1', LOG_KEY='vsprout_log_v1';

let words = [];
let settings = {
  theme:'', autoSpeak:false, desiredRetention:0.9, enableFuzz:true,
  showIpa:true, showPos:true, showRetrievability:true, showExample:true,
  showCollocations:true, showSynonyms:true, showAntonyms:true, showNote:true,
  dailyGoal:30
};
function fsrsOpts(){ return {retention: settings.desiredRetention||0.9, fuzz: settings.enableFuzz!==false}; }
// Shared 4-grade rating row (Again/Hard/Good/Easy) for Learn & Review flashcards,
// with a preview of the resulting review interval under each button.
function rateRowHTML(idPrefix, callbackName, w){
  const preview = FSRS.previewIntervals(w, Date.now(), fsrsOpts());
  const eta = g => esc(FSRS.formatInterval(preview[g]));
  return `
    <div class="rate-row" id="${idPrefix}RateRow" style="display:none;">
      <button class="rate-btn again" id="${idPrefix}AgainBtn" disabled onclick="${callbackName}(1)">Again<span class="sub">${eta(1)}</span></button>
      <button class="rate-btn hard" id="${idPrefix}HardBtn" disabled onclick="${callbackName}(2)">Hard<span class="sub">${eta(2)}</span></button>
      <button class="rate-btn good" id="${idPrefix}GoodBtn" disabled onclick="${callbackName}(3)">Good<span class="sub">${eta(3)}</span></button>
      <button class="rate-btn easy" id="${idPrefix}EasyBtn" disabled onclick="${callbackName}(4)">Easy<span class="sub">${eta(4)}</span></button>
    </div>`;
}
let dailyLog = {}; // { 'YYYY-MM-DD': {reviews:n, learned:n, correct:n, grades:{1,2,3,4}, timeMs:n} }
let lastActionTime = 0;
let chartRange = 7;
const TRIM_KEY='vsprout_trim_v1'; // marks that old built-in word sets have been removed

function loadData(){
  try{ words = JSON.parse(localStorage.getItem(DB_KEY)) || null; }catch(e){ words=null; }
  if(!words){
    words = ALL_TOPIC_WORDS.map(w=>makeCard(w));
    saveWords();
    localStorage.setItem(TRIM_KEY,'1');
  } else {
    let changed = false;
    if(!localStorage.getItem(TRIM_KEY)){
      // one-time migration: remove the old pre-finance built-in word sets,
      // keep everything else (finance words + anything the user added)
      const legacyWords = new Set(LEGACY_STARTER_WORDS.map(w=>w.word.toLowerCase()));
      words = words.filter(w=>!legacyWords.has(w.word.toLowerCase()));
      localStorage.setItem(TRIM_KEY,'1');
      changed = true;
    }
    // self-maintaining sync: whenever new words are added to ALL_TOPIC_WORDS
    // in a future update, existing installs automatically pick them up here —
    // no per-batch version flag needed going forward.
    const existing = new Set(words.map(w=>w.word.toLowerCase()));
    const missing = ALL_TOPIC_WORDS.filter(w=>!existing.has(w.word.toLowerCase()));
    if(missing.length){
      words = words.concat(missing.map(w=>makeCard(w)));
      changed = true;
    }
    if(changed) saveWords();
  }
  try{ settings = Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY))||{}); }catch(e){}
  try{ dailyLog = JSON.parse(localStorage.getItem(LOG_KEY)) || {}; }catch(e){}
}
function saveWords(){ localStorage.setItem(DB_KEY, JSON.stringify(words)); }
function saveSettings(){ localStorage.setItem(SET_KEY, JSON.stringify(settings)); }
function saveLog(){ localStorage.setItem(LOG_KEY, JSON.stringify(dailyLog)); }
function toChipArr(v){
  if(Array.isArray(v)) return v.map(s=>String(s).trim()).filter(Boolean);
  if(typeof v==='string') return v.split(',').map(s=>s.trim()).filter(Boolean);
  return [];
}
function makeCard(w){
  return {
    id: 'w'+Date.now()+Math.random().toString(36).slice(2,7),
    word:w.word, ipa:w.ipa||'', pos:w.pos||'', meaning:w.meaning, example:w.example||'', exampleVi:w.exampleVi||'',
    collocations:toChipArr(w.collocations), synonyms:toChipArr(w.synonyms), antonyms:toChipArr(w.antonyms),
    topic:w.topic||'Chung', cefr:w.cefr||'', note:w.note||'',
    state:'new', difficulty:0, stability:0, due:0, lastReview:0, reps:0, lapses:0, createdAt:Date.now(),
    correctCount:0, wrongCount:0, lastGrade:null, wrongStreak:0
  };
}
function todayKey(d){ d=d||new Date(); return d.toISOString().slice(0,10); }
function logEvent(type){
  const k = todayKey();
  if(!dailyLog[k]) dailyLog[k]={reviews:0,learned:0,correct:0,total:0};
  if(type==='review'){ dailyLog[k].reviews++; dailyLog[k].total++; }
  if(type==='learned'){ dailyLog[k].learned++; dailyLog[k].total++; }
  if(type==='correct'){ dailyLog[k].correct++; }
  saveLog();
}
function logStudyActivity(grade){
  const k = todayKey();
  if(!dailyLog[k]) dailyLog[k]={reviews:0,learned:0,correct:0,total:0};
  if(!dailyLog[k].grades) dailyLog[k].grades={1:0,2:0,3:0,4:0};
  dailyLog[k].grades[grade] = (dailyLog[k].grades[grade]||0)+1;
  const now = Date.now();
  if(lastActionTime>0){
    const gap = now-lastActionTime;
    if(gap>0 && gap<120000) dailyLog[k].timeMs = (dailyLog[k].timeMs||0)+gap; // ignore long idle gaps
  }
  lastActionTime = now;
  saveLog();
}

/* ============================= TTS ============================= */
let ttsVoice = null;
function pickBestVoice(){
  const voices = window.speechSynthesis.getVoices();
  if(!voices.length) return null;
  const enVoices = voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith('en'));
  const pool = enVoices.length ? enVoices : voices;
  // Prefer natural/neural/online engines (much less robotic than default local voices)
  const rank = v=>{
    const n = v.name.toLowerCase();
    if(n.includes('natural')) return 0;
    if(n.includes('neural') || n.includes('online')) return 1;
    if(n.includes('google us english') || n.includes('google uk english')) return 2;
    if(n.includes('samantha') || n.includes('aria') || n.includes('guy')) return 2;
    if(n.includes('google')) return 3;
    if(v.localService===false) return 4;
    return 5;
  };
  return pool.slice().sort((a,b)=>rank(a)-rank(b))[0];
}
// Voice list loads async on first page interaction in some browsers, and the
// very first speechSynthesis.speak() call has a noticeable startup delay
// (esp. Chrome) — call this once when entering a flashcard session so the
// voice is picked and the engine warmed up before the user taps play.
function warmUpTTS(){
  if(!('speechSynthesis' in window)) return;
  const load = ()=>{ const v = pickBestVoice(); if(v) ttsVoice = v; };
  load();
  if(!ttsVoice) window.speechSynthesis.onvoiceschanged = load;
  try{
    const warm = new SpeechSynthesisUtterance(' ');
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  }catch(e){}
}
function speak(text){
  if(!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='en-US'; u.rate=0.92; u.pitch=1;
  if(!ttsVoice) warmUpTTS();
  if(ttsVoice){ u.voice = ttsVoice; u.lang = ttsVoice.lang || 'en-US'; }
  window.speechSynthesis.speak(u);
}

/* ============================= NAV ============================= */
function setNavVisible(visible){
  const nav = document.getElementById('nav');
  if(nav) nav.style.display = visible ? '' : 'none';
}
function goTab(tab){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
  setNavVisible(true);
  if(tab==='home') renderHome();
  if(tab==='learn') renderLearn();
  if(tab==='review') renderReview();
  if(tab==='stats') renderStats();
  window.scrollTo(0,0);
}
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>goTab(b.dataset.tab)));

/* ============================= HOME ============================= */
function endOfToday(){
  const d = new Date(); d.setHours(23,59,59,999); return d.getTime();
}
function startOfToday(){
  const d = new Date(); d.setHours(0,0,0,0); return d.getTime();
}
function getDueWords(){
  const cutoff = endOfToday();
  return words.filter(w=>w.state!=='new' && w.due<=cutoff);
}
function getNewWords(){ return words.filter(w=>w.state==='new'); }

/* ---- Weak-word detection: based on review history, not a single answer ---- */
function updateWeakTracking(w, grade){
  w.correctCount = w.correctCount || 0;
  w.wrongCount = w.wrongCount || 0;
  w.wrongStreak = w.wrongStreak || 0;
  if(grade===1){
    w.wrongCount++;
    w.wrongStreak++;
  } else {
    w.correctCount++;
    w.wrongStreak = 0;
  }
  w.lastGrade = grade;
}
function wordAccuracy(w){
  const total = (w.correctCount||0) + (w.wrongCount||0);
  return total>0 ? (w.correctCount||0)/total : 1;
}
function isWordWeak(w){
  if(w.state==='new') return false;
  const wrong = w.wrongCount||0;
  const accuracy = wordAccuracy(w);
  const stability = w.stability||0;
  return wrong>=2
      || accuracy<0.70
      || w.lastGrade===1
      || (stability>0 && stability<3)
      || (w.wrongStreak||0)>=2;
}
function weakScore(w){
  const wrong = w.wrongCount||0;
  const accuracy = wordAccuracy(w);
  const stability = w.stability||0;
  let score = 0;
  score += wrong*15;
  score += Math.max(0, 0.70-accuracy)*100;
  score += w.lastGrade===1 ? 25 : 0;
  score += (stability>0 && stability<3) ? (3-stability)*10 : 0;
  score += (w.wrongStreak||0)*10;
  return score;
}
function getWeakWords(){
  return words.filter(isWordWeak).sort((a,b)=>weakScore(b)-weakScore(a));
}

/* ---- Study-queue ordering: weak → recently-seen → hard → normal → mastered,
   shuffled within each tier so words don't always appear in the same order. ---- */
function shuffleArr(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function priorityTier(w){
  if(isWordWeak(w)) return 0;                                          // từ yếu
  if(w.lastReview && w.state!=='new' && (Date.now()-w.lastReview) < 2*86400000) return 1; // vừa học/xem gần đây
  if((w.difficulty||0) >= 7) return 2;                                 // từ khó
  if(w.state==='review' && (w.stability||0) >= 21) return 4;           // đã thành thạo
  return 3;                                                            // bình thường
}
function priorityOrder(list){
  const tiers = [[],[],[],[],[]];
  list.forEach(w=>tiers[priorityTier(w)].push(w));
  return tiers.flatMap(shuffleArr);
}
/* Order due cards by how overdue they are (most overdue first), with a light
   shuffle among cards that became due on the same day — matches how modern
   SRS apps queue reviews. */
function overdueOrder(list){
  const buckets = {};
  list.forEach(w=>{
    const dayKey = Math.floor(w.due/86400000);
    (buckets[dayKey] = buckets[dayKey] || []).push(w);
  });
  return Object.keys(buckets).sort((a,b)=>a-b).flatMap(k=>shuffleArr(buckets[k]));
}

function vnDateLine(){
  const daysVi = ['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${daysVi[d.getDay()]}, ${dd}/${mm}/${d.getFullYear()}`;
}
// Home's "Học ngay" jumps straight into the most useful action: clear due
// reviews first (they're time-sensitive), otherwise go learn new words.
function homeStartNow(){
  if(getDueWords().length>0){ goTab('review'); startReviewMode('flashcard'); return; }
  if(getNewWords().length>0){ goTab('learn'); return; }
  showToast('Tuyệt vời! Bạn đã học hết rồi 🎉');
}
function groupByTopic(){
  const byTopic = {};
  words.forEach(w=>{
    const t = w.topic||'Chung';
    (byTopic[t] = byTopic[t] || []).push(w);
  });
  return byTopic;
}
function renderHome(){
  const due = getDueWords();
  const news = getNewWords();
  const streak = computeStreak();

  const hour = new Date().getHours();
  document.getElementById('homeGreeting').textContent = hour<11?'Chào buổi sáng ☀️':hour<18?'Chào buổi chiều 🌤':'Chào buổi tối 🌙';
  document.getElementById('homeDateLine').textContent = vnDateLine();
  document.getElementById('homeStreakPill').textContent = `🔥 ${streak}`;

  document.getElementById('homeDueNum').textContent = due.length;
  document.getElementById('homeNewNum').textContent = news.length;

  const goal = settings.dailyGoal||30;
  const todayLog = dailyLog[todayKey()] || {};
  const doneToday = todayLog.total||0;
  const pct = goal>0 ? Math.min(100, Math.round(doneToday/goal*100)) : 0;
  const minutes = Math.round((todayLog.timeMs||0)/60000);
  document.getElementById('homeGoalText').textContent = `${doneToday}/${goal}`;
  document.getElementById('homeProgressFill').style.width = pct+'%';
  document.getElementById('homeProgressPct').textContent = pct+'%';
  document.getElementById('homeProgressCount').textContent = `${doneToday} / ${goal} từ`;
  document.getElementById('homeProgressMin').textContent = `${minutes} phút`;

  document.getElementById('statTotal').textContent = words.length;
  document.getElementById('statLearned').textContent = words.filter(w=>w.state==='review').length;
  document.getElementById('statDue').textContent = due.length;
  document.getElementById('statStreak').textContent = streak;

  const byTopic = groupByTopic();
  const topTopics = Object.keys(byTopic).map(t=>({t, stat:topicStatsFor(byTopic[t])}))
    .sort((a,b)=> (b.stat.newCount+b.stat.dueCount)-(a.stat.newCount+a.stat.dueCount) || a.t.localeCompare(b.t))
    .slice(0,5);
  document.getElementById('homeTopicList').innerHTML = topTopics.length
    ? topTopics.map(x=>topicCardHTML(x.t, byTopic[x.t])).join('')
    : `<p style="color:var(--ink-soft); font-size:13px;">Chưa có chủ đề nào.</p>`;

  const weak = getWeakWords().slice(0,5);
  document.getElementById('homeWeakList').innerHTML = weak.length
    ? weak.map(w=>weakItemHTML(w, 'goReviewWeak()')).join('')
    : `<p style="color:var(--ink-soft); font-size:13px;">Không có từ yếu nào — làm tốt lắm! 🎉</p>`;
}
function computeStreak(){
  let streak=0; let d=new Date();
  if(!dailyLog[todayKey(d)]) d.setDate(d.getDate()-1);
  while(dailyLog[todayKey(d)]){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}
function computeBestStreak(){
  const keys = Object.keys(dailyLog).sort();
  let best=0,cur=0,prev=null;
  keys.forEach(k=>{
    const d=new Date(k);
    if(prev){ const diff=Math.round((d-prev)/86400000); cur = diff===1?cur+1:1; } else cur=1;
    prev=d; best=Math.max(best,cur);
  });
  return best;
}

/* ============================= SHARED CARD RENDER ============================= */
function computeRetrievability(w){
  if(!w.lastReview || w.state==='new' || !w.stability) return null;
  const elapsedDays = Math.max(0, (Date.now()-w.lastReview)/86400000);
  return FSRS.retrievability(elapsedDays, w.stability);
}
function retrievabilityBadgeHTML(w){
  const r = computeRetrievability(w);
  if(r===null) return '';
  const pct = Math.round(r*100);
  const cls = pct>=80 ? 'good' : pct>=50 ? 'mid' : 'low';
  return `<span class="retr-badge ${cls}" title="Khả năng bạn còn nhớ từ này">🧠 ${pct}%</span>`;
}
function cardFrontHTML(w, hintId){
  return `
    <div class="face-topic-row" style="justify-content:flex-end;">
      ${settings.showRetrievability!==false ? retrievabilityBadgeHTML(w) : ''}
    </div>
    <div class="face-center">
      <div class="word-main">${esc(w.word)}</div>
      <div style="display:flex; gap:6px;">
        ${(w.pos && settings.showPos!==false)?`<span class="pos-badge">${esc(w.pos)}</span>`:''}
        ${w.cefr?`<span class="pos-badge" style="background:var(--easy); color:#fff;">${esc(w.cefr)}</span>`:''}
      </div>
      ${settings.showIpa!==false ? `<div class="ipa">${esc(w.ipa)}</div>` : ''}
      <button class="speak-btn" onclick="event.stopPropagation();speak('${escJs(w.word)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg></button>
    </div>
    <div class="tap-hint" id="${hintId||''}">Chạm để xem nghĩa</div>
  `;
}
function cardBackHTML(w){
  let html = `<div class="meaning-main">${esc(w.meaning)}</div>`;
  if(w.example && settings.showExample!==false){
    html += `<div class="example-box">“${esc(w.example)}”${w.exampleVi?`<div class="example-vi">${esc(w.exampleVi)}</div>`:''}</div>`;
  }
  if(w.collocations && w.collocations.length && settings.showCollocations!==false){
    html += `<div><div class="back-label">Collocation</div><div class="chip-row">${w.collocations.map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div></div>`;
  }
  if(w.synonyms && w.synonyms.length && settings.showSynonyms!==false){
    html += `<div><div class="back-label">Đồng nghĩa</div><div class="chip-row">${w.synonyms.map(c=>`<span class="chip syn">${esc(c)}</span>`).join('')}</div></div>`;
  }
  if(w.antonyms && w.antonyms.length && settings.showAntonyms!==false){
    html += `<div><div class="back-label">Trái nghĩa</div><div class="chip-row">${w.antonyms.map(c=>`<span class="chip ant">${esc(c)}</span>`).join('')}</div></div>`;
  }
  if(w.note && settings.showNote!==false){
    html += `<div><div class="back-label">Lưu ý cách dùng</div><div style="font-size:12.5px; color:var(--ink-soft); font-style:italic;">${esc(w.note)}</div></div>`;
  }
  return html;
}

/* ============================= LEARN ============================= */
let learnQueue=[], learnIdx=0, learnFlipped=false, currentLearnTopic='', learnSessionMode='new';
function topicEmoji(t){
  const map={'TOEIC':'📘','Tính cách':'🌟','Công việc':'💼','Học thuật':'🎓','Thông dụng':'💬','Du lịch':'✈️','Tài chính - Ngân hàng':'🏦','Chung':'📚'};
  return map[t] || '📚';
}
function renderLearn(){
  document.getElementById('learnStudy').style.display='none';
  document.getElementById('learnTopics').style.display='block';
  renderTopicList();
}
function topicStatsFor(topicWords){
  const total = topicWords.length;
  const learned = topicWords.filter(w=>w.state!=='new').length;
  const newCount = total-learned;
  const dueCount = topicWords.filter(w=>w.state!=='new' && w.due<=Date.now()).length;
  return {total, learned, newCount, dueCount};
}
function topicCefrLabel(topicWords){
  const counts = {};
  topicWords.forEach(w=>{ if(w.cefr) counts[w.cefr] = (counts[w.cefr]||0)+1; });
  const levels = Object.keys(counts);
  if(levels.length===0) return '';
  levels.sort((a,b)=>counts[b]-counts[a]);
  return levels[0];
}
function topicCardHTML(t, topicWords){
  const stat = topicStatsFor(topicWords);
  const pct = stat.total? Math.round(stat.learned/stat.total*100) : 0;
  const cefr = topicCefrLabel(topicWords);
  let badges = [
    stat.newCount>0 ? `<span class="topic-badge new">🟢 ${stat.newCount} mới</span>` : '',
    stat.dueCount>0 ? `<span class="topic-badge due">🟠 ${stat.dueCount} ôn</span>` : '',
  ].join('');
  if(!badges) badges = `<span class="topic-badge flat">✓ Ổn định</span>`;
  return `
    <div class="card topic-card" onclick="startTopicFlashcard('${escJs(t)}')">
      <div class="topic-emoji">${topicEmoji(t)}</div>
      <div class="topic-info">
        <div class="topic-name">${esc(t)}</div>
        <div class="topic-meta">${stat.total} từ${cefr?` • ${esc(cefr)}`:''}</div>
        <div class="topic-progress-row">
          <div class="topic-progress-track"><div class="topic-progress-fill" style="width:${pct}%"></div></div>
          <span class="topic-progress-num">${stat.learned}/${stat.total} từ</span>
        </div>
      </div>
      <div class="topic-badges-corner">${badges}</div>
    </div>`;
}
function renderTopicList(){
  const byTopic = groupByTopic();
  let names = Object.keys(byTopic);

  // quick stat: total new (unlearned) words across the whole vocab
  const totalNew = words.filter(w=>w.state==='new').length;
  document.getElementById('quickStatNew').textContent = `🌱 ${totalNew} từ mới`;

  const query = (document.getElementById('topicSearch').value||'').trim().toLowerCase();
  if(query) names = names.filter(t=>t.toLowerCase().includes(query));
  names.sort((a,b)=>a.localeCompare(b));

  const list = document.getElementById('topicList');
  if(names.length===0){
    list.innerHTML = `<div class="empty-state"><div class="em">🌾</div><h3 style="margin:0 0 6px;">${query?'Không tìm thấy chủ đề':'Chưa có từ nào'}</h3><p>${query?'Thử từ khoá khác nhé.':'Hãy thêm từ vựng trong Cài đặt để bắt đầu học.'}</p></div>`;
    return;
  }
  list.innerHTML = names.map(t=>topicCardHTML(t, byTopic[t])).join('');
}

/* Tap a topic → jump straight into flashcard study, picking whichever
   action is most useful: new words first, else due review, else replay
   everything for extra practice. */
function startTopicFlashcard(topic){
  const topicWords = words.filter(w=>(w.topic||'Chung')===topic);
  const stat = topicStatsFor(topicWords);
  if(stat.newCount>0) startLearnTopic(topic);
  else if(stat.dueCount>0) startTopicReview(topic);
  else if(stat.total>0) startRelearnTopic(topic);
}

let learnCompletedIds = new Set(), learnOriginalTotal = 0;
function startLearnTopic(topic){
  const topicWords = words.filter(w=>(w.topic||'Chung')===topic);
  const newInTopic = topicWords.filter(w=>w.state==='new');
  currentLearnTopic = topic;
  learnSessionMode = 'new';
  // brand-new words have no history yet, so this is effectively a shuffle —
  // still important so the same topic doesn't always start with the same word
  learnQueue = priorityOrder(newInTopic);
  learnIdx = 0; learnFlipped=false; lastActionTime = Date.now();
  learnCompletedIds = new Set(); learnOriginalTotal = learnQueue.length;
  document.getElementById('learnCount').textContent = `0/${learnOriginalTotal}`;
  document.getElementById('learnProgress').style.width='0%';
  document.getElementById('learnTopics').style.display='none';
  document.getElementById('learnStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawLearnCard();
}
function startRelearnTopic(topic){
  const topicWords = words.filter(w=>(w.topic||'Chung')===topic);
  currentLearnTopic = topic;
  learnSessionMode = 'relearn';
  // relearn doesn't touch the daily new-word quota — it's just extra practice
  learnQueue = priorityOrder(topicWords);
  learnIdx = 0; learnFlipped=false; lastActionTime = Date.now();
  learnCompletedIds = new Set(); learnOriginalTotal = learnQueue.length;
  document.getElementById('learnCount').textContent = `0/${learnOriginalTotal}`;
  document.getElementById('learnProgress').style.width='0%';
  document.getElementById('learnTopics').style.display='none';
  document.getElementById('learnStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawLearnCard();
}
function backToTopicListFromStudy(){
  document.getElementById('learnStudy').style.display='none';
  document.getElementById('learnTopics').style.display='block';
  setNavVisible(true);
  renderTopicList();
}
let reviewCompletedIds = new Set(), reviewOriginalTotal = 0;
/* Review a single topic's due words directly from the topic list (jumps
   into the Ôn tập tab's Flashcard mode, filtered to just this topic). */
function startTopicReview(topic){
  goTab('review');
  let due = overdueOrder(getDueWords().filter(w=>(w.topic||'Chung')===topic));
  isPracticeMode = false;
  reviewQueue = due; reviewIdx=0; reviewMode='flashcard'; reviewFlipped=false; lastActionTime=Date.now();
  reviewCompletedIds = new Set(); reviewOriginalTotal = reviewQueue.length;
  document.getElementById('reviewCount').textContent = `0/${reviewOriginalTotal}`;
  document.getElementById('reviewProgress').style.width='0%';
  document.getElementById('reviewModes').style.display='none';
  document.getElementById('reviewStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawReviewCard();
}
function drawLearnCard(){
  const area = document.getElementById('learnArea');
  if(learnIdx >= learnQueue.length){
    const msg = learnSessionMode==='relearn'
      ? `Bạn vừa học lại xong toàn bộ từ của "${esc(currentLearnTopic)}".`
      : `Bạn đã học hết từ mới của "${esc(currentLearnTopic)}".`;
    area.innerHTML = `<div class="empty-state"><div class="em">🌾</div><h3 style="margin:0 0 6px;">Xong chủ đề này!</h3><p>${msg}</p><button class="btn btn-primary" style="margin-top:12px;" onclick="backToTopicListFromStudy()">Quay lại danh sách</button></div>`;
    return;
  }
  const w = learnQueue[learnIdx];
  learnFlipped=false;
  area.innerHTML = `
    <div class="card-stage">
      <div class="flashcard" id="learnCard" onclick="flipLearn()">
        <div class="face">${cardFrontHTML(w, 'learnTapHint')}</div>
        <div class="face face-back">
          <div class="face-center">${cardBackHTML(w)}</div>
        </div>
      </div>
    </div>
    ${rateRowHTML('learn', 'learnRate', w)}
  `;
}
function flipLearn(){
  learnFlipped=!learnFlipped;
  document.getElementById('learnCard').classList.toggle('flipped',learnFlipped);
  const btnIds = ['learnAgainBtn','learnHardBtn','learnGoodBtn','learnEasyBtn'];
  btnIds.forEach(id=>document.getElementById(id).disabled = !learnFlipped);
  document.getElementById('learnRateRow').style.display = learnFlipped ? 'grid' : 'none';
  if(learnFlipped && settings.autoSpeak) speak(learnQueue[learnIdx].word);
}
function learnRate(grade){
  const w = learnQueue[learnIdx];
  const res = FSRS.schedule(w, grade, Date.now(), fsrsOpts());
  Object.assign(w, res);
  updateWeakTracking(w, grade);
  saveWords();
  logStudyActivity(grade);
  if(learnSessionMode==='relearn'){
    logEvent('review');
  } else {
    logEvent('learned');
  }
  if(grade>=3) logEvent('correct');
  if(grade===1){
    // "Quên": bring this card back later in the same session instead of losing it until next time
    const insertAt = Math.min(learnQueue.length, learnIdx + 1 + Math.min(3, learnQueue.length-learnIdx-1));
    learnQueue.splice(insertAt, 0, w);
  } else {
    learnCompletedIds.add(w.id); // genuinely done, won't be requeued
  }
  learnIdx++;
  updateLearnProgress();
  drawLearnCard();
}
function updateLearnProgress(){
  const done = Math.min(learnCompletedIds.size, learnOriginalTotal);
  document.getElementById('learnCount').textContent = `${done}/${learnOriginalTotal}`;
  const pct = learnOriginalTotal? (done/learnOriginalTotal*100):0;
  document.getElementById('learnProgress').style.width=pct+'%';
}

/* ============================= REVIEW ============================= */
let reviewQueue=[], reviewIdx=0, reviewFlipped=false, reviewMode='flashcard';
let quizAnswered=false, typingAnswered=false, pendingGrade=3;
let isPracticeMode=false, practiceStats={correct:0,total:0}, practiceKind='quick';

function renderReview(){
  document.getElementById('reviewStudy').style.display='none';
  document.getElementById('reviewModes').style.display='block';
  renderReviewModeList();
}
function renderReviewModeList(){
  const due = getDueWords();
  const weak = getWeakWords();
  const learnedCount = words.filter(w=>w.state!=='new').length;
  const banner = document.getElementById('reviewDueBanner');
  const list = document.getElementById('reviewModeList');

  banner.innerHTML = due.length>0
    ? `<div class="pill" style="margin-bottom:14px;">🔁 ${due.length} từ cần ôn hôm nay</div>`
    : '';

  // 1. Primary CTA — the main recommended flow
  const cta = document.getElementById('reviewMainCta');
  cta.disabled = due.length<=0;
  cta.textContent = due.length>0 ? `🔁 Ôn tập hôm nay (${due.length})` : '🔁 Không có từ cần ôn hôm nay';

  // 2 & 3. Từ yếu, Luyện tập nhanh
  const items = [
    {emoji:'🎯', name:'Từ yếu', sub:'Chưa nhớ ổn định, dễ quên · xếp theo mức yếu', count:weak.length, action:"startWeakPractice()"},
    {emoji:'⚡', name:'Luyện tập nhanh', sub:'Trắc nghiệm ngẫu nhiên · không ảnh hưởng lịch ôn', count:learnedCount, action:"startQuickPractice()"},
  ];
  list.innerHTML = items.map(it=>{
    const disabled = it.count<=0;
    return `
    <div class="card topic-card${disabled?' disabled':''}" ${disabled?'':`onclick="${it.action}"`}>
      <div class="topic-emoji">${it.emoji}</div>
      <div class="topic-info">
        <div class="topic-name">${esc(it.name)}</div>
        <div class="topic-sub">${esc(it.sub)}</div>
      </div>
      <span class="topic-count${disabled?' zero':''}">${it.count}</span>
    </div>`;
  }).join('');

  // 4. Chế độ ôn khác — compact row, only used when you want a different format
  const modes = [
    {emoji:'🗂️', name:'Flashcard', action:"startReviewMode('flashcard')"},
    {emoji:'✅', name:'Trắc nghiệm', action:"startReviewMode('quiz')"},
    {emoji:'⌨️', name:'Gõ từ', action:"startReviewMode('typing')"},
  ];
  document.getElementById('reviewModeSwitchRow').innerHTML = modes.map(m=>`
    <button class="mode-switch-btn" ${due.length<=0?'disabled':''} onclick="${m.action}">
      <span class="msb-emoji">${m.emoji}</span>
      <span class="msb-name">${esc(m.name)}</span>
    </button>`).join('');
}
function startReviewMode(mode){
  let due = overdueOrder(getDueWords()); // most overdue first, light shuffle within same due-day
  isPracticeMode = false;
  reviewQueue = due; reviewIdx=0; reviewMode=mode; reviewFlipped=false; lastActionTime = Date.now();
  reviewCompletedIds = new Set(); reviewOriginalTotal = reviewQueue.length;
  document.getElementById('reviewCount').textContent = `0/${reviewOriginalTotal}`;
  document.getElementById('reviewProgress').style.width='0%';
  document.getElementById('reviewModes').style.display='none';
  document.getElementById('reviewStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawReviewCard();
}
function startQuickPractice(){
  const pool = words.filter(w=>w.state!=='new');
  const shuffled = pool.slice();
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  isPracticeMode = true;
  practiceKind = 'quick';
  practiceStats = {correct:0, total:0};
  reviewQueue = shuffled.slice(0, Math.min(15, shuffled.length));
  reviewIdx = 0; reviewMode = 'quiz'; reviewFlipped=false; lastActionTime = Date.now();
  reviewCompletedIds = new Set(); reviewOriginalTotal = reviewQueue.length;
  document.getElementById('reviewCount').textContent = `0/${reviewOriginalTotal}`;
  document.getElementById('reviewProgress').style.width='0%';
  document.getElementById('reviewModes').style.display='none';
  document.getElementById('reviewStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawReviewCard();
}
function startWeakPractice(){
  const pool = getWeakWords();
  if(pool.length===0){ showToast('Không còn từ yếu nào 🎉'); backToReviewModes(); return; }
  const shuffled = pool.slice();
  for(let i=shuffled.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  isPracticeMode = true;
  practiceKind = 'weak';
  practiceStats = {correct:0, total:0};
  reviewQueue = shuffled;
  reviewIdx = 0; reviewMode = 'quiz'; reviewFlipped=false; lastActionTime = Date.now();
  reviewCompletedIds = new Set(); reviewOriginalTotal = reviewQueue.length;
  document.getElementById('reviewCount').textContent = `0/${reviewOriginalTotal}`;
  document.getElementById('reviewProgress').style.width='0%';
  document.getElementById('reviewModes').style.display='none';
  document.getElementById('reviewStudy').style.display='block';
  setNavVisible(false);
  warmUpTTS();
  drawReviewCard();
}
function backToReviewModes(){
  document.getElementById('reviewStudy').style.display='none';
  document.getElementById('reviewModes').style.display='block';
  setNavVisible(true);
  renderReviewModeList();
}
function drawReviewCard(){
  const area = document.getElementById('reviewArea');
  if(reviewIdx >= reviewQueue.length){
    if(isPracticeMode){
      const pct = practiceStats.total? Math.round(practiceStats.correct/practiceStats.total*100) : 0;
      const restartFn = practiceKind==='weak' ? 'startWeakPractice()' : 'startQuickPractice()';
      const emoji = practiceKind==='weak' ? '🎯' : '⚡';
      area.innerHTML = `<div class="empty-state"><div class="em">${emoji}</div><h3 style="margin:0 0 6px;">Luyện tập xong!</h3><p>Đúng ${practiceStats.correct}/${practiceStats.total} (${pct}%). Kết quả này không ảnh hưởng lịch ôn tập.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="${restartFn}">Luyện tập lại</button><button class="btn btn-ghost" style="margin-top:8px;" onclick="backToReviewModes()">Chọn chế độ khác</button></div>`;
    } else {
      area.innerHTML = `<div class="empty-state"><div class="em">✅</div><h3 style="margin:0 0 6px;">Đã ôn xong!</h3><p>Không còn từ nào cần ôn lúc này.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="backToReviewModes()">Chọn chế độ khác</button></div>`;
    }
    return;
  }
  const w = reviewQueue[reviewIdx];
  if(reviewMode==='quiz') drawQuizReview(w, area);
  else if(reviewMode==='typing') drawTypingReview(w, area);
  else drawFlashcardReview(w, area);
}
function gradeReviewWord(grade, requeueAtEnd){
  const w = reviewQueue[reviewIdx];
  updateWeakTracking(w, grade);
  logStudyActivity(grade);
  if(isPracticeMode){
    practiceStats.total++;
    if(grade>=3) practiceStats.correct++;
    saveWords();
  } else {
    const res = FSRS.schedule(w, grade, Date.now(), fsrsOpts());
    Object.assign(w,res);
    saveWords();
    logEvent('review');
    if(grade>=3) logEvent('correct');
  }
  if(grade===1){
    // "Quên": bring this card back within the next 3-5 questions
    const offset = 3 + Math.floor(Math.random()*3); // 3, 4, or 5
    const insertAt = Math.min(reviewQueue.length, reviewIdx + 1 + Math.min(offset, reviewQueue.length-reviewIdx-1));
    reviewQueue.splice(insertAt, 0, w);
  } else if(requeueAtEnd){
    // Correct, but took too long to answer — not confident yet, revisit once
    // more at the end of this session instead of counting it as solid.
    reviewQueue.push(w);
  } else {
    reviewCompletedIds.add(w.id); // genuinely done, won't be requeued
  }
  reviewIdx++;
  const done = Math.min(reviewCompletedIds.size, reviewOriginalTotal);
  document.getElementById('reviewCount').textContent = `${done}/${reviewOriginalTotal}`;
  const pct = reviewOriginalTotal? (done/reviewOriginalTotal*100):0;
  document.getElementById('reviewProgress').style.width=pct+'%';
  drawReviewCard();
}

/* --- Mode 1: Flashcard (FSRS 4-grade) --- */
function drawFlashcardReview(w, area){
  reviewFlipped=false;
  area.innerHTML = `
    <div class="card-stage">
      <div class="flashcard" id="reviewCard" onclick="flipReview()">
        <div class="face">${cardFrontHTML(w, 'reviewTapHint')}</div>
        <div class="face face-back">
          <div class="face-center">${cardBackHTML(w)}</div>
        </div>
      </div>
    </div>
    ${rateRowHTML('review', 'gradeReviewWord', w)}
  `;
}
function flipReview(){
  reviewFlipped=!reviewFlipped;
  document.getElementById('reviewCard').classList.toggle('flipped',reviewFlipped);
  const btnIds = ['reviewAgainBtn','reviewHardBtn','reviewGoodBtn','reviewEasyBtn'];
  btnIds.forEach(id=>document.getElementById(id).disabled = !reviewFlipped);
  document.getElementById('reviewRateRow').style.display = reviewFlipped ? 'grid' : 'none';
  if(reviewFlipped && settings.autoSpeak) speak(reviewQueue[reviewIdx].word);
}

/* --- Mode 2: Trắc nghiệm (multiple choice) --- */
function distractorScore(candidate, target){
  let score = 0;
  if(candidate.pos && candidate.pos===target.pos) score += 2;
  if((candidate.topic||'Chung')===(target.topic||'Chung')) score += 1;
  return score;
}
function pickSmartDistractors(target, count, field){
  const pool = words.filter(x=>x.id!==target.id && x[field] && x[field]!==target[field]);
  const isHardStage = (target.correctCount||0) >= 2; // seen it right a couple times already
  const scored = pool.map(w=>({w, score: distractorScore(w, target), r: Math.random()}));
  scored.sort((a,b)=> isHardStage ? (b.score-a.score || a.r-b.r) : (a.r-b.r));
  return scored.slice(0,count).map(x=>x.w[field]);
}
let quizQuestionStart = 0, quizType = 'en2vi';
function drawQuizReview(w, area){
  quizAnswered=false;
  quizQuestionStart = Date.now();
  const canContext = !!(w.example && w.example.toLowerCase().includes(w.word.toLowerCase()));
  const roll = Math.random();
  quizType = roll<0.4 ? 'en2vi' : (roll<0.7 || !canContext ? 'vi2en' : 'context');

  let promptHTML, options, correctVal;
  if(quizType==='vi2en'){
    correctVal = w.word;
    options = [w.word, ...pickSmartDistractors(w,3,'word')];
    promptHTML = `
      <div class="card" style="padding:26px 20px; text-align:center; margin-bottom:6px;">
        <div class="eyebrow" style="margin-bottom:8px;">Từ nào có nghĩa là:</div>
        <div class="meaning-main" style="margin:0;">${esc(w.meaning)}</div>
      </div>`;
  } else if(quizType==='context'){
    correctVal = w.word;
    options = [w.word, ...pickSmartDistractors(w,3,'word')];
    const blanked = w.example.replace(new RegExp(w.word,'ig'), '_____');
    promptHTML = `
      <div class="card" style="padding:26px 20px; text-align:center; margin-bottom:6px;">
        <div class="eyebrow" style="margin-bottom:8px;">Điền từ còn thiếu:</div>
        <div class="example-box" style="margin:0; text-align:center;">“${esc(blanked)}”</div>
      </div>`;
  } else {
    correctVal = w.meaning;
    options = [w.meaning, ...pickSmartDistractors(w,3,'meaning')];
    promptHTML = `
      <div class="card" style="padding:26px 20px; text-align:center; margin-bottom:6px;">
        <div class="word-main" style="margin:0 0 4px;">${esc(w.word)}</div>
        ${w.pos?`<span class="pos-badge">${esc(w.pos)}</span>`:''}
        <div class="ipa" style="margin-top:8px;">${esc(w.ipa)}</div>
        <div style="margin-top:10px;"><button class="speak-btn" style="margin:0 auto;" onclick="speak('${escJs(w.word)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg></button></div>
      </div>`;
  }
  for(let i=options.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [options[i],options[j]]=[options[j],options[i]]; }
  area.innerHTML = `
    ${promptHTML}
    <div class="quiz-options" id="quizOptions">
      ${options.map(opt=>`<button class="quiz-opt" data-correct="${opt===correctVal?1:0}" onclick="selectQuizOption(this)">${esc(opt)}</button>`).join('')}
    </div>
    <div id="quizNextWrap" style="display:none; margin-top:14px;"><button class="btn btn-primary btn-block" onclick="gradeReviewWord(pendingGrade, pendingRequeueEnd)">Tiếp theo →</button></div>
  `;
}
let pendingRequeueEnd = false;
function selectQuizOption(el){
  if(quizAnswered) return;
  quizAnswered=true;
  const isCorrect = el.dataset.correct==='1';
  const elapsed = Date.now()-quizQuestionStart;
  document.querySelectorAll('.quiz-opt').forEach(b=>{
    b.disabled=true;
    if(b.dataset.correct==='1') b.classList.add('correct');
  });
  if(!isCorrect) el.classList.add('wrong');
  const slow = isCorrect && elapsed>8000;
  pendingGrade = !isCorrect ? 1 : (slow ? 2 : 3); // wrong=Again, slow-correct=Hard, fast-correct=Good
  pendingRequeueEnd = slow;
  if(settings.autoSpeak) speak(reviewQueue[reviewIdx].word);
  document.getElementById('quizNextWrap').style.display='block';
}

/* --- Mode 3: Gõ từ (typing) --- */
function drawTypingReview(w, area){
  typingAnswered=false;
  area.innerHTML = `
    <div class="card" style="padding:26px 20px; text-align:center; margin-bottom:16px;">
      <div class="meaning-main" style="margin:0 0 4px;">${esc(w.meaning)}</div>
      ${w.pos?`<span class="pos-badge">${esc(w.pos)}</span>`:''}
      ${w.example?`<div class="example-box" style="margin-top:14px;">“${esc(w.example.replace(new RegExp(w.word,'ig'),'_____'))}”</div>`:''}
    </div>
    <input type="text" id="typingInput" class="typing-input" placeholder="Gõ từ tiếng Anh..." autocomplete="off" autocapitalize="off" spellcheck="false" onkeydown="if(event.key==='Enter') submitTyping()">
    <div id="typingFeedback"></div>
    <button class="btn btn-primary btn-block" id="typingActionBtn" style="margin-top:14px;" onclick="submitTyping()">Kiểm tra</button>
  `;
  setTimeout(()=>{ const inp=document.getElementById('typingInput'); if(inp) inp.focus(); },80);
}
function submitTyping(){
  if(typingAnswered){ gradeReviewWord(pendingGrade); return; }
  const w = reviewQueue[reviewIdx];
  const inp = document.getElementById('typingInput');
  const val = (inp.value||'').trim().toLowerCase();
  const correct = val === w.word.toLowerCase();
  typingAnswered=true;
  inp.disabled=true;
  document.getElementById('typingFeedback').innerHTML = correct
    ? `<div class="typing-fb ok">✓ Chính xác!</div>`
    : `<div class="typing-fb bad">✗ Chưa đúng — đáp án: ${esc(w.word)}</div>`;
  pendingGrade = correct?3:1;
  if(settings.autoSpeak) speak(w.word);
  document.getElementById('typingActionBtn').textContent='Tiếp theo →';
}

/* ============================= STATS ============================= */
function setChartRange(n){
  chartRange = n;
  document.querySelectorAll('#chartRangeToggle .seg-btn').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.range)===n);
  });
  renderStatsChart();
}
function renderStatsChart(){
  const days=[]; const now=new Date();
  for(let i=chartRange-1;i>=0;i--){ const d=new Date(now); d.setDate(now.getDate()-i); days.push(d); }
  const counts = days.map(d=> (dailyLog[todayKey(d)]||{}).total||0 );
  const max = Math.max(1,...counts);
  document.getElementById('barChart').innerHTML = counts.map(c=>`<div class="bar" style="height:${Math.max(4,c/max*100)}%"></div>`).join('');
  document.getElementById('barLabel').innerHTML = days.map(d=>`<span>${chartRange<=7? d.getDate() : (d.getDate()%5===0? d.getDate():'')}</span>`).join('');
}
function renderGradeBar(counts){
  const parts = [
    {g:1,label:'Again',color:'var(--again)'},
    {g:2,label:'Hard', color:'var(--hard)'},
    {g:3,label:'Good', color:'var(--good)'},
    {g:4,label:'Easy', color:'var(--easy)'},
  ];
  const total = parts.reduce((s,p)=>s+(counts[p.g]||0),0);
  const bar = document.getElementById('gradeBar');
  const legend = document.getElementById('gradeLegend');
  if(total===0){
    bar.innerHTML = '';
    legend.innerHTML = `<span>Chưa có dữ liệu</span>`;
    return;
  }
  bar.innerHTML = parts.map(p=>{
    const pct = (counts[p.g]||0)/total*100;
    return pct>0 ? `<div style="width:${pct}%;background:${p.color};"></div>` : '';
  }).join('');
  legend.innerHTML = parts.map(p=>{
    const pct = Math.round((counts[p.g]||0)/total*100);
    return `<span><span class="dot" style="background:${p.color};"></span>${p.label} ${pct}%</span>`;
  }).join('');
}
function renderFsrsDonut(seg){
  const parts = [
    {label:'Chưa học', value:seg.new, color:'var(--ink-soft)'},
    {label:'Đang học', value:seg.learning, color:'var(--hard)'},
    {label:'Đã nhớ', value:seg.review, color:'var(--easy)'},
    {label:'Thành thạo', value:seg.mature, color:'var(--good)'},
  ];
  const total = parts.reduce((s,p)=>s+p.value,0) || 1;
  let acc = 0;
  const stops = parts.map(p=>{
    const start = acc/total*360; acc += p.value; const end = acc/total*360;
    return p.value>0 ? `${p.color} ${start}deg ${end}deg` : null;
  }).filter(Boolean).join(', ') || 'var(--bg-2) 0deg 360deg';
  document.getElementById('fsrsDonut').style.background = `conic-gradient(${stops})`;
  document.getElementById('fsrsLegend').innerHTML = parts.map(p=>`
    <div class="ditem"><span class="dot" style="background:${p.color};"></span>${p.label}<span class="dval">${p.value}</span></div>
  `).join('');
}
const ACHIEVEMENT_DEFS = [
  {emoji:'🔥', name:'Học 7 ngày liên tiếp', check: a=>Math.max(a.streak,a.best)>=7},
  {emoji:'📚', name:'Học 100 từ', check: a=>a.learnedWords>=100},
  {emoji:'💯', name:'Accuracy > 95%', check: a=>a.totalGraded>=20 && a.accuracy>0.95},
  {emoji:'🚀', name:'30 ngày không bỏ học', check: a=>a.best>=30},
  {emoji:'⭐', name:'1000 lần ôn', check: a=>a.totalReviewsAllTime>=1000},
];
function renderAchievements(){
  const totalReviewsAllTime = Object.values(dailyLog).reduce((s,l)=>s+(l.reviews||0),0);
  const totalGraded = Object.values(dailyLog).reduce((s,l)=>s+(l.reviews||0)+(l.learned||0),0);
  const totalCorrect = Object.values(dailyLog).reduce((s,l)=>s+(l.correct||0),0);
  const accuracy = totalGraded>0 ? totalCorrect/totalGraded : 0;
  const ctx = {
    totalReviewsAllTime, totalGraded, accuracy,
    learnedWords: words.filter(w=>w.state!=='new').length,
    streak: computeStreak(), best: computeBestStreak()
  };
  document.getElementById('achvGrid').innerHTML = ACHIEVEMENT_DEFS.map(a=>{
    const unlocked = a.check(ctx);
    return `<div class="achv-badge${unlocked?' unlocked':''}"><div class="achv-emoji">${a.emoji}</div><div class="achv-name">${esc(a.name)}</div></div>`;
  }).join('');
}
function goReviewWeak(){
  goTab('review');
  startWeakPractice();
}
function showWeakDetail(){
  document.getElementById('statsMain').style.display='none';
  document.getElementById('weakDetailScreen').style.display='block';
  renderWeakDetailList();
}
function backToStatsMain(){
  document.getElementById('weakDetailScreen').style.display='none';
  document.getElementById('statsMain').style.display='block';
}
function weakItemHTML(w, onclick){
  const acc = Math.round(wordAccuracy(w)*100);
  return `
    <div class="card topic-card${onclick?'':' disabled'}" ${onclick?`onclick="${onclick}"`:''}>
      <div class="topic-emoji">🎯</div>
      <div class="topic-info">
        <div class="topic-name">${esc(w.word)}</div>
        <div class="topic-sub">${esc(w.meaning)}</div>
      </div>
      <span class="topic-count zero" style="background:var(--again); color:#fff; text-align:right; line-height:1.25; padding:6px 10px;">Sai ${w.wrongCount||0}×<br><span style="font-weight:600; font-size:9.5px; opacity:.9;">${acc}% đúng</span></span>
    </div>`;
}
function renderWeakDetailList(){
  const weak = getWeakWords();
  document.getElementById('weakReviewBtn').style.display = weak.length? 'block':'none';
  document.getElementById('weakFullList').innerHTML = weak.length
    ? weak.map(w=>weakItemHTML(w)).join('')
    : `<p style="color:var(--ink-soft); font-size:13px; margin:4px 0;">Không có từ yếu nào — làm tốt lắm! 🎉</p>`;
}
function renderStats(){
  document.getElementById('weakDetailScreen').style.display='none';
  document.getElementById('statsMain').style.display='block';
  // 1. Streak
  document.getElementById('statStreakBig').textContent = computeStreak();
  document.getElementById('statBestStreakBig').textContent = computeBestStreak();

  // 2. Tổng quan
  const total = words.length;
  const learned = words.filter(w=>w.state!=='new').length;
  const remaining = total-learned;
  document.getElementById('ovTotal').textContent = total;
  document.getElementById('ovLearned').textContent = learned;
  document.getElementById('ovRemaining').textContent = remaining;
  document.getElementById('ovCompletion').textContent = total? Math.round(learned/total*100)+'%' : '0%';

  // 3. Hôm nay
  const k = todayKey();
  const today = dailyLog[k] || {};
  document.getElementById('todayLearned').textContent = today.learned||0;
  document.getElementById('todayReviewed').textContent = today.reviews||0;
  const mins = Math.round((today.timeMs||0)/60000);
  document.getElementById('todayTime').textContent = mins>0 ? mins+' phút' : '< 1 phút';

  // Hiệu suất
  const totalGraded = Object.values(dailyLog).reduce((s,l)=>s+(l.reviews||0)+(l.learned||0),0);
  const totalCorrect = Object.values(dailyLog).reduce((s,l)=>s+(l.correct||0),0);
  document.getElementById('perfAccuracy').textContent = totalGraded? Math.round(totalCorrect/totalGraded*100)+'%' : '—';
  document.getElementById('perfForgotToday').textContent = (today.grades && today.grades[1]) || 0;
  const gradeTotals = {1:0,2:0,3:0,4:0};
  Object.values(dailyLog).forEach(l=>{ if(l.grades) [1,2,3,4].forEach(g=>gradeTotals[g]+=l.grades[g]||0); });
  renderGradeBar(gradeTotals);

  // 4. Biểu đồ
  renderStatsChart();

  // 5. Tiến độ FSRS
  let seg = {new:0, learning:0, review:0, mature:0};
  words.forEach(w=>{
    if(w.state==='new') seg.new++;
    else if(w.state==='learning' || w.state==='relearning') seg.learning++;
    else if(w.state==='review' && (w.stability||0)>=21) seg.mature++;
    else seg.review++;
  });
  renderFsrsDonut(seg);

  // 6. Từ yếu — compact summary card (tap opens weakDetailScreen for the full list)
  const weak = getWeakWords();
  document.getElementById('weakSummaryCount').textContent = weak.length ? `${weak.length} từ yếu` : 'Không có từ yếu';
  document.getElementById('weakSummarySub').textContent = weak.length
    ? `Từ yếu nhất: ${weak[0].word}`
    : 'Chưa nhớ ổn định, dễ quên';
  document.getElementById('weakSummaryCard').style.opacity = weak.length ? '1' : '.55';

  // 7. Thành tích
  renderAchievements();
}

/* ============================= SETTINGS ============================= */
function applySettingsUI(){
  document.getElementById('swAutoSpeak').classList.toggle('on', !!settings.autoSpeak);
  document.getElementById('valRetention').textContent = Math.round((settings.desiredRetention||0.9)*100)+'%';
  document.getElementById('swEnableFuzz').classList.toggle('on', settings.enableFuzz!==false);
  document.getElementById('swDarkMode').classList.toggle('on', settings.theme==='dark');
  document.documentElement.className = settings.theme||'';
  ['showPos','showIpa','showRetrievability','showExample','showCollocations','showSynonyms','showAntonyms','showNote'].forEach(key=>{
    const el = document.getElementById('sw'+key.charAt(0).toUpperCase()+key.slice(1));
    if(el) el.classList.toggle('on', settings[key]!==false);
  });
}
function openCardFieldsModal(){ document.getElementById('cardFieldsModal').classList.add('open'); }
function setTheme(t){ settings.theme=t; saveSettings(); applySettingsUI(); }
function toggleDarkMode(){ setTheme(settings.theme==='dark' ? '' : 'dark'); }
function changeSetting(key,delta){
  settings[key] = Math.max(0, (settings[key]||0)+delta);
  saveSettings(); applySettingsUI();
}
function changeRetention(deltaPct){
  let pct = Math.round((settings.desiredRetention||0.9)*100) + deltaPct;
  pct = Math.max(75, Math.min(97, pct));
  settings.desiredRetention = pct/100;
  saveSettings(); applySettingsUI();
}
function toggleSetting(key,el){
  settings[key] = !settings[key];
  saveSettings(); applySettingsUI();
}
function confirmReset(){
  document.getElementById('confirmModal').classList.add('open');
}
function performReset(){
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(LOG_KEY);
  localStorage.removeItem(TRIM_KEY);
  loadData();
  closeModal('confirmModal');
  showToast('Đã xoá toàn bộ dữ liệu');
  goTab('home');
}
function exportData(){
  const blob = new Blob([JSON.stringify({words,dailyLog},null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vocab-sprout-backup.json';
  a.click();
  showToast('Đã xuất file backup');
}

/* ============================= MODALS ============================= */
function openAddModal(){ document.getElementById('addModal').classList.add('open'); }
function openImportModal(){ document.getElementById('importModal').classList.add('open'); }
function openRestoreModal(){ document.getElementById('restoreModal').classList.add('open'); }
function submitRestore(){
  try{
    const data = JSON.parse(document.getElementById('fRestore').value);
    if(!data || !Array.isArray(data.words)) throw new Error('invalid');
    words = data.words;
    dailyLog = data.dailyLog && typeof data.dailyLog==='object' ? data.dailyLog : {};
    saveWords(); saveLog();
    document.getElementById('fRestore').value='';
    closeModal('restoreModal');
    showToast(`Đã khôi phục ${words.length} từ`);
    renderHome();
  }catch(e){ showToast('File không hợp lệ'); }
}
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
function submitAddWord(){
  const word = document.getElementById('fWord').value.trim();
  const meaning = document.getElementById('fMeaning').value.trim();
  if(!word || !meaning){ showToast('Cần nhập từ và nghĩa'); return; }
  const card = makeCard({
    word, meaning,
    ipa: document.getElementById('fIpa').value.trim(),
    pos: document.getElementById('fPos').value.trim(),
    example: document.getElementById('fExample').value.trim(),
    exampleVi: document.getElementById('fExampleVi').value.trim(),
    collocations: document.getElementById('fCollocations').value.trim(),
    synonyms: document.getElementById('fSynonyms').value.trim(),
    antonyms: document.getElementById('fAntonyms').value.trim(),
    cefr: document.getElementById('fCefr').value.trim(),
    note: document.getElementById('fNote').value.trim(),
    topic: document.getElementById('fTopic').value.trim()||'Chung'
  });
  words.unshift(card); saveWords();
  ['fWord','fIpa','fPos','fMeaning','fExample','fExampleVi','fCollocations','fSynonyms','fAntonyms','fCefr','fNote','fTopic'].forEach(id=>document.getElementById(id).value='');
  closeModal('addModal'); showToast('Đã thêm từ mới 🌱'); renderHome();
}
function submitImport(){
  try{
    const arr = JSON.parse(document.getElementById('fImport').value);
    if(!Array.isArray(arr)) throw new Error();
    let n=0;
    arr.forEach(w=>{ if(w.word && w.meaning){ words.unshift(makeCard(w)); n++; } });
    saveWords();
    document.getElementById('fImport').value='';
    closeModal('importModal');
    showToast(`Đã nhập ${n} từ`); renderHome();
  }catch(e){ showToast('JSON không hợp lệ'); }
}

/* ============================= HELPERS ============================= */
function esc(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escJs(s){ return (s||'').replace(/'/g,"\\'"); }
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
}

/* ============================= INIT ============================= */
loadData();
applySettingsUI();
renderHome();
