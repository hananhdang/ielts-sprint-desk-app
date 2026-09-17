(function () {
  'use strict';

  const AI = window.IELTSAI;
  if (!AI) return;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STORE_KEY = 'ielts-smart-features-v1';
  const FEED_CACHE_KEY = 'ielts-listening-feed-cache-v4';
  const state = loadState();

  function loadState() {
    try {
      return Object.assign({ writingReviews: [], quizReviews: [], speakingSessions: [], listenedEpisodes: {} }, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    } catch (_) {
      return { writingReviews: [], quizReviews: [], speakingSessions: [], listenedEpisodes: {} };
    }
  }
  function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  function toast(message) {
    const box = $('#toast');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => box.classList.remove('show'), 2400);
  }
  function requireKey() {
    if (AI.getKey()) return true;
    toast('请先到“设置”填写 Gemini API Key');
    openView('settings');
    setTimeout(() => $('#smartGeminiKey')?.focus(), 100);
    return false;
  }
  function openView(view) {
    $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    const title = $('#topTitle');
    if (title) title.textContent = view === 'bbc' ? '每日英语听力' : title.textContent;
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.IELTSOpenView = openView;
  function buttonBusy(button, busy, busyText, idleText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }
  function formatError(error) {
    return error && error.message ? error.message : 'AI 请求失败，请稍后重试。';
  }
  function formatDate(date) {
    try { return new Intl.DateTimeFormat('zh-CN', { month:'short', day:'numeric' }).format(new Date(date)); }
    catch (_) { return ''; }
  }

  function installNavigation() {
    const desktop = $('#desktopNav');
    const mobile = $('#mobileNav');
    if (desktop && !desktop.querySelector('[data-view="bbc"]')) {
      const button = document.createElement('button');
      button.dataset.view = 'bbc';
      button.innerHTML = '<i>♫</i>每日听力';
      desktop.querySelector('[data-view="training"]')?.before(button);
      button.addEventListener('click', () => openView('bbc'));
    }
    if (mobile && !mobile.querySelector('[data-view="bbc"]')) {
      const button = document.createElement('button');
      button.dataset.view = 'bbc';
      button.innerHTML = '<i>♫</i>听力';
      mobile.querySelector('[data-view="training"]')?.before(button);
      button.addEventListener('click', () => openView('bbc'));
    }
  }

  function installAISettings() {
    const grid = $('#view-settings .grid');
    if (!grid || $('#smartAISettings')) return;
    const card = document.createElement('article');
    card.className = 'card';
    card.id = 'smartAISettings';
    card.style.gridColumn = 'span 12';
    card.innerHTML = `
      <div class="card-head"><div><h3>AI 教练设置</h3><div class="small muted">写作批改、口语对话和错题复盘共用。Key 只保存在当前标签页。</div></div><span class="badge" id="aiReadyBadge">未连接</span></div>
      <div class="key-box"><div class="inline-fields"><div class="field"><label>Gemini API Key</label><input type="password" id="smartGeminiKey" autocomplete="off" placeholder="AIza…"></div><div class="field"><label>模型</label><input id="smartGeminiModel" value="${esc(AI.getModel())}"></div></div>
      <div class="smart-actions"><button class="btn primary" id="saveAISettings" type="button">保存到本次标签页</button><button class="btn" id="testAISettings" type="button">测试连接</button><button class="btn danger" id="clearAISettings" type="button">清除 Key</button><a class="btn" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">获取 Gemini Key ↗</a></div>
      <p class="key-note">Key 通过 HTTPS 直接发送给 Google Gemini，不会进入本站源码、GitHub 仓库或长期学习备份。关闭这个标签页后会清除。AI 反馈是训练估分，不是官方成绩。训练流程参考的开源项目及许可见 <a href="./THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">第三方许可</a>。</p></div>`;
    grid.appendChild(card);
    const keyInput = $('#smartGeminiKey');
    const modelInput = $('#smartGeminiModel');
    keyInput.value = AI.getKey();
    const sync = () => {
      const ready = Boolean(AI.getKey());
      const badge = $('#aiReadyBadge');
      badge.textContent = ready ? 'AI 已就绪' : '未连接';
      badge.classList.toggle('orange', !ready);
      const oldKey = $('#geminiKey');
      if (oldKey) oldKey.value = AI.getKey();
      const oldModel = $('#geminiModel');
      if (oldModel) oldModel.value = AI.getModel();
    };
    $('#saveAISettings').onclick = () => {
      AI.setKey(keyInput.value);
      AI.setModel(modelInput.value || AI.DEFAULT_MODEL);
      sync();
      toast('AI 设置已保存到当前标签页');
    };
    $('#clearAISettings').onclick = () => {
      AI.clearApiKey();
      keyInput.value = '';
      sync();
      toast('Key 已从当前标签页清除');
    };
    $('#testAISettings').onclick = async event => {
      const button = event.currentTarget;
      AI.setKey(keyInput.value);
      AI.setModel(modelInput.value || AI.DEFAULT_MODEL);
      if (!requireKey()) return;
      buttonBusy(button, true, '测试中…', '测试连接');
      try {
        const answer = await AI.generateText('Reply with exactly: IELTS coach ready', { temperature:0, maxOutputTokens:20 });
        toast(/ready/i.test(answer) ? '连接成功，AI 教练已就绪' : '连接成功');
      } catch (error) { toast(formatError(error)); }
      finally { buttonBusy(button, false, '测试中…', '测试连接'); sync(); }
    };
    const oldKey = $('#geminiKey');
    if (oldKey) {
      oldKey.value = AI.getKey();
      oldKey.addEventListener('input', () => { AI.setKey(oldKey.value); keyInput.value = oldKey.value; sync(); });
    }
    const oldModel = $('#geminiModel');
    if (oldModel) oldModel.addEventListener('change', () => { AI.setModel(oldModel.value); modelInput.value = AI.getModel(); });
    sync();
  }

  function installSmartBackup() {
    const exportButton=$('#exportData'),importInput=$('#importData');
    if(exportButton)exportButton.onclick=()=>{
      let app={};try{app=JSON.parse(localStorage.getItem('ielts-sprint-desk-v1')||'{}')}catch(_){}
      const payload={schema:'ielts-sprint-smart-backup-v2',exportedAt:new Date().toISOString(),app,smart:state};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`ielts-smart-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('完整备份已导出（不含 API Key）');
    };
    if(importInput)importInput.onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text()),app=data.schema==='ielts-sprint-smart-backup-v2'?data.app:data;if(!app?.settings||!Array.isArray(app.training))throw Error('invalid');localStorage.setItem('ielts-sprint-desk-v1',JSON.stringify(app));if(data.smart)localStorage.setItem(STORE_KEY,JSON.stringify(data.smart));toast('备份已导入，即将刷新');setTimeout(()=>location.reload(),500);}catch(_){toast('备份文件格式不正确');}event.target.value='';};
  }

  const WRITING_SCHEMA = {
    type:'object',
    properties:{
      overall:{type:'number'}, summary:{type:'string'},
      scores:{type:'object',properties:{task_response:{type:'number'},coherence_cohesion:{type:'number'},lexical_resource:{type:'number'},grammatical_range_accuracy:{type:'number'}},required:['task_response','coherence_cohesion','lexical_resource','grammatical_range_accuracy']},
      evidence:{type:'array',items:{type:'object',properties:{quote:{type:'string'},criterion:{type:'string'},problem:{type:'string'},revision:{type:'string'}},required:['quote','criterion','problem','revision']}},
      top_actions:{type:'array',items:{type:'string'}}, revision_task:{type:'string'}, improved_excerpt:{type:'string'},
      previous_issues:{type:'array',items:{type:'object',properties:{issue:{type:'string'},status:{type:'string'},evidence:{type:'string'}},required:['issue','status','evidence']}}
    }, required:['overall','summary','scores','evidence','top_actions','revision_task','improved_excerpt']
  };
  function writingPrompt(compare) {
    const type = $('#writingType').value;
    const title = $('#writingTitle').value.trim();
    const essay = $('#writingText').value.trim();
    const prior = compare ? [...state.writingReviews].reverse().find(x => x.type === type && x.title === title && x.draft !== essay) : null;
    return `你是严格的 IELTS Academic 写作教练。按官方四项标准给练习估分，每项只能用0.5档。先检查任务完成度，再评 TA/TR、CC、LR、GRA。每个问题必须引用学生原句；只给最影响提分的三项动作。保留作者观点，只局部示范，不整篇代写。${prior?'这是二稿。先逐项判断上次问题 fixed、improved、unchanged、worsened 或 no longer relevant，再重新估分。上次诊断：'+JSON.stringify(prior.result):'这是首次批改。'}\n\n类型：${type}\n题目：${title}\n作文：\n${essay}`;
  }
  function renderWritingReview(item) {
    const out = $('#writingAIOutput');
    if (!item || !item.result) { out.textContent = '完成作文后，点击“批改当前稿”。'; return; }
    const r = item.result, scores = r.scores || {}, labels = [['task_response','任务回应'],['coherence_cohesion','连贯衔接'],['lexical_resource','词汇'],['grammatical_range_accuracy','语法']];
    out.innerHTML = `<div class="ai-status"><span class="badge orange">练习估分 ${esc(r.overall)}</span><span class="small muted">${esc(new Date(item.at).toLocaleString('zh-CN'))}</span></div><p>${esc(r.summary)}</p><div class="rubric-grid">${labels.map(([k,l])=>`<div class="rubric-card"><b>${esc(scores[k] ?? '—')}</b><span>${l}</span></div>`).join('')}</div><h4>最优先的三项修改</h4><div class="issue-list">${(r.top_actions||[]).slice(0,3).map(x=>`<div class="issue">${esc(x)}</div>`).join('')}</div><h4>原句证据与局部改法</h4><div class="issue-list">${(r.evidence||[]).slice(0,6).map(x=>`<div class="issue"><b>${esc(x.criterion)}</b><p>“${esc(x.quote)}”</p><p>${esc(x.problem)}</p><p><b>可改为：</b>${esc(x.revision)}</p></div>`).join('')}</div>${r.previous_issues?.length?`<h4>二稿变化</h4><div class="issue-list">${r.previous_issues.map(x=>`<div class="issue"><b>${esc(x.status)}</b> · ${esc(x.issue)}<p>${esc(x.evidence)}</p></div>`).join('')}</div>`:''}<h4>本轮重写任务</h4><p>${esc(r.revision_task)}</p><h4>局部示范</h4><p>${esc(r.improved_excerpt)}</p>`;
  }
  function installWritingCoach() {
    const view = $('#view-writing');
    if (!view || $('#writingAICoach')) return;
    const panel = document.createElement('article');
    panel.className = 'card';
    panel.id = 'writingAICoach';
    panel.innerHTML = `<div class="card-head"><div><h3>AI 四维批改与二稿对比</h3><div class="small muted">按官方标准给练习估分，反馈绑定原句，最多抓三个优先问题。</div></div><span class="badge">TA/TR · CC · LR · GRA</span></div><div class="smart-actions"><button class="btn primary" id="reviewWriting" type="button">批改当前稿</button><button class="btn" id="compareWriting" type="button">检查二稿变化</button><button class="btn" id="loadLastReview" type="button">查看上次反馈</button></div><div class="smart-output" id="writingAIOutput">完成作文后，点击“批改当前稿”。</div>`;
    view.appendChild(panel);
    async function run(compare, button) {
      const essay = $('#writingText').value.trim();
      const title = $('#writingTitle').value.trim();
      if (essay.split(/\s+/).filter(Boolean).length < 80) return toast('正文太短，至少写 80 词后再批改');
      if (!title) return toast('请先填写完整题目');
      if (/^官方真题\/样题：/.test(title) && /https?:\/\//.test(title)) return toast('这道官方题尚未载入完整题面，请把完整题干粘贴到题目栏');
      if (compare && ![...state.writingReviews].reverse().some(x => x.type === $('#writingType').value && x.title === title && x.draft !== essay)) return toast('当前题目没有可对比的上一稿，请先批改初稿');
      if (!requireKey()) return;
      $('#saveVersion').click();
      buttonBusy(button, true, compare?'对比中…':'批改中…', compare?'检查二稿变化':'批改当前稿');
      const out = $('#writingAIOutput');
      out.classList.add('loading'); out.textContent = 'AI 正在按四项标准检查原句证据…';
      try {
        const result = await AI.generateJSON(writingPrompt(compare), { responseSchema:WRITING_SCHEMA, temperature:0.15, maxOutputTokens:3000, timeoutMs:90000 });
        const item = { at:new Date().toISOString(), type:$('#writingType').value, title:$('#writingTitle').value.trim(), draft:$('#writingText').value, result };
        state.writingReviews.push(item); state.writingReviews = state.writingReviews.slice(-12); saveState(); renderWritingReview(item); toast('AI 写作反馈已生成');
      } catch (error) { out.textContent = '批改失败：' + formatError(error); }
      finally { out.classList.remove('loading'); buttonBusy(button, false, '', compare?'检查二稿变化':'批改当前稿'); }
    }
    $('#reviewWriting').onclick = e => run(false, e.currentTarget);
    $('#compareWriting').onclick = e => {
      if (!state.writingReviews.length) return toast('先完成一次初稿批改');
      run(true, e.currentTarget);
    };
    $('#loadLastReview').onclick = () => renderWritingReview(state.writingReviews[state.writingReviews.length - 1]);
    if (state.writingReviews.length) renderWritingReview(state.writingReviews[state.writingReviews.length - 1]);
  }

  const SPEAKING_SCHEMA = {
    type:'object', properties:{
      transcript:{type:'string'}, phase:{type:'string'}, next_question:{type:'string'}, brief_feedback:{type:'string'}, session_complete:{type:'boolean'},
      scores:{type:'object',properties:{fluency_coherence:{type:'number'},lexical_resource:{type:'number'},grammatical_range_accuracy:{type:'number'},pronunciation:{type:'number'}}},
      top_issues:{type:'array',items:{type:'string'}}, natural_version:{type:'string'}
    }, required:['transcript','phase','next_question','brief_feedback','session_complete']
  };
  function installSpeakingCoach() {
    const view = $('#view-speaking');
    if (!view || $('#liveSpeakingCoach')) return;
    const panel = document.createElement('article');
    panel.className = 'card'; panel.id = 'liveSpeakingCoach';
    panel.innerHTML = `<div class="card-head"><div><h3>AI 连续语音对练</h3><div class="small muted">AI 一次问一题；你录音后，它会听懂回答并继续追问。</div></div><span class="badge">iPhone 可用</span></div><div class="coach-stage"><span data-phase="part1">Part 1</span><span data-phase="part2">Part 2</span><span data-phase="part3">Part 3</span><span data-phase="feedback">反馈与重答</span></div><div class="field"><label>训练模式</label><select id="speechCoachMode"><option value="quick">快速对练 · 3轮即时纠错</option><option value="exam">完整模拟 · Part 1–3结束后反馈</option></select></div><div class="coach-question" id="coachQuestion">点击“开始新对话”，AI 考官会朗读第一题。</div><div class="smart-actions"><button class="btn primary" id="startCoach" type="button">开始新对话</button><button class="btn orange" id="coachRecord" type="button" disabled>🎙 开始回答</button><button class="btn" id="speakCoachQuestion" type="button" disabled>🔊 重播题目</button></div><div class="field"><label>无法录音时可输入回答</label><textarea id="coachTypedAnswer" placeholder="也可以在这里输入英文回答"></textarea></div><button class="btn" id="sendTypedAnswer" type="button" disabled>发送文字回答</button><div class="coach-log" id="coachLog"></div><div class="smart-output" id="coachFinal" hidden></div><p class="key-note">点击“发送这段回答”后，本轮音频会发送至 Google Gemini；录音不会写入长期备份。音频存在时才会给 Pronunciation 训练估分。</p>`;
    view.querySelector('.grid')?.before(panel);
    let session = null, recorder = null, recordingPromise = null;
    const q = $('#coachQuestion'), recordButton = $('#coachRecord'), typedButton = $('#sendTypedAnswer');
    function paintPhase(phase) { $$('[data-phase]').forEach(x => x.classList.toggle('active', x.dataset.phase === phase)); }
    function addTurn(role, text) { const el=document.createElement('div');el.className='coach-turn '+role;el.innerHTML=`<b>${role==='user'?'你的回答':'AI 考官'}</b>${esc(text)}`;$('#coachLog').appendChild(el);el.scrollIntoView({block:'nearest'}); }
    function firstQuestion(mode) { return mode==='exam'?'Let’s talk about your work. What do you enjoy most about your current job?':'What is one part of your working day that you would like to describe?'; }
    function buildPrompt(answerText, hasAudio) {
      const mode=session.mode, max=mode==='exam'?9:3, turn=session.turn+1, nextTurn=turn+1;
      const nextPhase=mode==='quick'?'part1':nextTurn===5?'part2':nextTurn>=6?'part3':'part1';
      const history=session.history.map(x=>`${x.role}: ${x.text}`).join('\n');
      return `Act as an IELTS Speaking coach. Ask exactly one question at a time in natural British English. Mode=${mode}; this is answer ${turn} of ${max}. ${mode==='exam'?'Do not give feedback between questions. Questions 1-4 are Part 1, question 5 is one concise Part 2 cue card, and questions 6-9 are analytical Part 3 follow-ups.':'Give one short, useful correction after each answer.'} ${turn>=max?'End the session now and give four band estimates. Set phase=feedback and session_complete=true.':`The next question is number ${nextTurn}; it must be ${nextPhase}. Set phase=${nextPhase} and session_complete=false.`} Transcribe the current ${hasAudio?'audio':'typed'} answer faithfully. Do not invent words. Only score pronunciation when audio is supplied. Keep feedback to the top 3 issues, provide one natural improved version using the learner’s own meaning. Return JSON only.\n\nConversation so far:\n${history}\nCurrent question: ${session.question}\nTyped answer if present: ${answerText||'(audio attached)'}`;
    }
    function renderFinal(r) {
      const scores=r.scores||{}, labels=[['fluency_coherence','FC'],['lexical_resource','LR'],['grammatical_range_accuracy','GRA'],['pronunciation','P']];
      const out=$('#coachFinal'); out.hidden=false;
      out.innerHTML=`<h4>本场训练反馈</h4><div class="rubric-grid">${labels.map(([k,l])=>`<div class="rubric-card"><b>${esc(scores[k]??'—')}</b><span>${l}</span></div>`).join('')}</div><div class="issue-list">${(r.top_issues||[]).slice(0,3).map(x=>`<div class="issue">${esc(x)}</div>`).join('')}</div>${r.natural_version?`<h4>自然表达版本</h4><p>${esc(r.natural_version)}</p>`:''}`;
      paintPhase('feedback');
      state.speakingSessions.push({at:new Date().toISOString(),mode:session.mode,history:session.history,result:r});state.speakingSessions=state.speakingSessions.slice(-10);saveState();
    }
    async function analyse(audioBlob, typedText) {
      if (!session || session.busy) return;
      session.busy=true; recordButton.disabled=true; typedButton.disabled=true;
      q.textContent='AI 正在听你的回答并准备下一题…';
      try {
        const result=await AI.generateJSON(buildPrompt(typedText,Boolean(audioBlob)),{audioBlob,responseSchema:SPEAKING_SCHEMA,temperature:.35,maxOutputTokens:1800,timeoutMs:90000});
        const transcript=(result.transcript||typedText||'（未识别到清晰语音）').trim();
        addTurn('user',transcript); session.history.push({role:'Learner',text:transcript}); session.turn++;
        if (result.brief_feedback && session.mode==='quick') addTurn('ai','反馈：'+result.brief_feedback);
        if (result.session_complete || session.turn >= (session.mode==='exam'?9:3)) {
          q.textContent='本场对练完成。请看下方反馈，并选择最弱的一题重答。'; renderFinal(result); session.done=true;
        } else {
          session.question=result.next_question||'Could you explain that in a little more detail?'; session.history.push({role:'Examiner',text:session.question}); q.textContent=session.question; addTurn('ai',session.question); paintPhase(result.phase||'part1'); AI.speak(session.question).catch(()=>{});
        }
      } catch(error) { q.textContent=session.question; toast(formatError(error)); }
      finally { session.busy=false; buttonBusy(recordButton,false,'','🎙 开始回答'); recordButton.disabled=Boolean(session.done); typedButton.disabled=Boolean(session.done); recordButton.classList.remove('recording-now'); }
    }
    $('#startCoach').onclick=()=>{
      if(!requireKey())return; const mode=$('#speechCoachMode').value,question=firstQuestion(mode);
      session={mode,turn:0,question,history:[{role:'Examiner',text:question}],busy:false,done:false};$('#coachLog').innerHTML='';$('#coachFinal').hidden=true;q.textContent=question;addTurn('ai',question);recordButton.disabled=false;typedButton.disabled=false;$('#speakCoachQuestion').disabled=false;paintPhase('part1');AI.speak(question).catch(()=>{});
    };
    $('#speakCoachQuestion').onclick=()=>session&&AI.speak(session.question).catch(error=>toast(formatError(error)));
    recordButton.onclick=async()=>{
      if(!session||session.busy)return;
      if(recorder){buttonBusy(recordButton,true,'正在处理…','🎙 开始回答');try{const captured=await recorder.stop();recorder=null;await analyse(captured.blob,'');}catch(error){recorder=null;toast(formatError(error));buttonBusy(recordButton,false,'','🎙 开始回答');}return;}
      try{recorder=await AI.createAudioRecorder({maxDurationMs:125000});recordingPromise=recorder.start();recordButton.textContent='■ 发送这段回答';recordButton.classList.add('recording-now');toast('正在录音，再点一次即可发送');recordingPromise.catch(()=>{});}catch(error){recorder=null;toast(formatError(error));}
    };
    typedButton.onclick=()=>{const text=$('#coachTypedAnswer').value.trim();if(!text)return toast('请先输入英文回答');$('#coachTypedAnswer').value='';analyse(null,text);};
  }

  function installLegacySpeechUpgrade() {
    const button=$('#runSpeechAi'),key=$('#geminiKey'),model=$('#geminiModel'),transcript=$('#speechTranscript'),out=$('#speechAiResult');
    if(!button)return;
    button.onclick=async()=>{
      if(key?.value)AI.setKey(key.value);if(model?.value)AI.setModel(model.value);if(!transcript.value.trim())return toast('请先录音转写或粘贴回答');if(!requireKey())return;
      buttonBusy(button,true,'分析中…','AI直接分析');out.textContent='AI 正在检查回答…';
      try{out.textContent=await AI.generateText(`你是严格的IELTS口语教练。题目：${$('#speechCue').textContent}\n学生原话：${transcript.value}\n请按FC、LR、GRA评估；只有文字，明确说明不能可靠评价发音。引用原句，只给三个重点问题、一个自然改写和两道追问。`,{temperature:.2,maxOutputTokens:1800});}catch(error){out.textContent='分析失败：'+formatError(error);}finally{buttonBusy(button,false,'','AI直接分析');}
    };
  }

  const FEEDS = {
    cgtn:{label:'CGTN 国内新闻',page:'https://radio.cgtn.com',note:'国内 CDN · 2–10 分钟短新闻 · 无需 VPN',domestic:true},
    six:{label:'BBC 海外备用',page:'https://www.bbc.co.uk/learningenglish',rss:'https://podcasts.files.bbci.co.uk/p02pc9tn.rss',note:'海外备用 · 国内网络可能较慢 · 点击后才连接',domestic:false}
  };
  const DAILY_TABS=[['cgtn','CGTN 国内新闻'],['local','本机精听 · 免联网'],['six','BBC 海外备用']];
  const FALLBACK_EPISODES=[{title:'How reading shapes your brain',date:'2026-05-14',description:'6 Minute English：阅读如何改变大脑。',audio:'https://downloads.bbc.co.uk/learningenglish/features/6min/260514_6_minute_english_how_reading_shapes_your_brain_download.mp3',link:'https://www.bbc.co.uk/learningenglish/english/features/6-minute-english_2026/ep-260514'}];
  const bundledFeedPromises={};
  async function bundledEpisodes(key){
    const file=key==='cgtn'?'./cgtn-feed.json':'./bbc-feed.json';
    if(!bundledFeedPromises[file])bundledFeedPromises[file]=fetch(file,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()});
    const payload=await bundledFeedPromises[file],items=key==='cgtn'?payload?.episodes:payload?.feeds?.[key]?.episodes;
    return Array.isArray(items)?items:[];
  }
  function installBBC() {
    if ($('#view-bbc')) return;
    const section=document.createElement('section');section.className='view';section.id='view-bbc';
    section.innerHTML=`<div class="section-title"><div><h2>每日英语听力</h2><p>默认使用国内音频；BBC 仅作为网络条件允许时的拓展。</p></div><span class="badge" id="bbcRecommendation"></span></div><article class="card bbc-hero"><h3>每天只做一个 12–25 分钟闭环</h3><div class="listen-routine"><div><b>① 泛听</b><span>不暂停，写一句主旨</span></div><div><b>② 精听</b><span>重听一段，记3个词块</span></div><div><b>③ 输出</b><span>关掉音频，60秒英语复述</span></div></div><div class="smart-actions"><a class="btn smallbtn" href="https://radio.cgtn.com" target="_blank" rel="noopener noreferrer">CGTN Radio 国内站 ↗</a><a class="btn smallbtn" href="https://language.chinadaily.com.cn/news_bilingual" target="_blank" rel="noopener noreferrer">中国日报双语新闻 ↗</a></div></article><div class="feed-tabs" id="bbcFeedTabs">${DAILY_TABS.map(([k,label])=>`<button class="btn smallbtn" data-daily-feed="${k}">${esc(label)}</button>`).join('')}</div><div class="card"><p class="small muted" id="bbcFeedNote"></p><div class="episode-grid" id="bbcEpisodes"><div class="empty">正在读取国内听力…</div></div></div>`;
    $('#view-training')?.before(section);
    $('#bbcRecommendation').textContent='今日推荐：CGTN 国内 CDN · 无需 VPN';
    $$('[data-daily-feed]').forEach(b=>b.onclick=()=>loadDailyFeed(b.dataset.dailyFeed));
    loadDailyFeed('cgtn');
  }
  function activateDailyTab(key){$$('[data-daily-feed]').forEach(b=>b.classList.toggle('primary',b.dataset.dailyFeed===key));}
  function openLocalPractice(index){
    ($('#desktopNav [data-view="materials"]')||$('#mobileNav [data-view="materials"]'))?.click();
    $('[data-material="original"]')?.click();
    $('[data-original-subject="listening"]')?.click();
    $(`[data-pick-listening="${index}"]`)?.click();
  }
  function renderLocalListening(message='使用手机或电脑自带英文语音，不访问境外音频；页面缓存后可离线使用。'){
    const box=$('#bbcEpisodes'),items=window.IELTS_PRACTICE_LISTENING||[];if(!box)return;activateDailyTab('local');$('#bbcFeedNote').textContent=message;
    if(!items.length){box.innerHTML='<div class="empty">本机听力材料尚未载入，请刷新页面后重试。</div>';return;}
    const offset=Math.floor(Date.now()/86400000)%items.length,ordered=[...items.slice(offset),...items.slice(0,offset)];
    box.innerHTML=ordered.map((x,i)=>{const originalIndex=items.indexOf(x);return`<article class="episode"><div class="meta">本机语音 · Section ${esc(x.section)} · ${esc(x.level)}</div><h3>${esc(x.title)}</h3><p class="small muted">建议先盲听两遍，再进入题目与判分。</p><label class="small">语速 <select data-local-rate><option value="0.85">0.85×</option><option value="0.95" selected>0.95×</option><option value="1.05">1.05×</option><option value="1.15">1.15×</option></select></label><div class="smart-actions"><button class="btn primary" type="button" data-local-speak="${i}">▶ 本机朗读</button><button class="btn smallbtn" type="button" data-local-stop>■ 停止</button><button class="btn smallbtn" type="button" data-local-practice="${originalIndex}">进入题目与判分</button></div><details><summary>完成后查看原文</summary><p class="small">${esc(x.transcript)}</p></details></article>`}).join('');
    $$('[data-local-speak]').forEach(button=>button.onclick=()=>{const item=ordered[+button.dataset.localSpeak],rate=+(button.closest('.episode')?.querySelector('[data-local-rate]')?.value||.95);$$('[data-local-speak]').forEach(b=>{b.disabled=false;b.textContent='▶ 本机朗读'});button.disabled=true;button.textContent='正在朗读…';AI.speak(item.transcript,{lang:'en-GB',rate,maxChars:5000}).then(()=>{button.disabled=false;button.textContent='↻ 再听一遍'}).catch(()=>{button.disabled=false;button.textContent='▶ 本机朗读'});});
    $$('[data-local-stop]').forEach(button=>button.onclick=()=>{AI.stopSpeaking();$$('[data-local-speak]').forEach(b=>{b.disabled=false;b.textContent='▶ 本机朗读'});});
    $$('[data-local-practice]').forEach(button=>button.onclick=()=>openLocalPractice(+button.dataset.localPractice));
  }
  function loadDailyFeed(key){AI.stopSpeaking();if(key==='local'){renderLocalListening();return}loadFeed(key);}
  function readFeedCache(key){try{const all=JSON.parse(localStorage.getItem(FEED_CACHE_KEY)||'{}'),x=all[key],fresh=x&&Date.now()-x.at<21600000,items=x?.items,stable=Array.isArray(items)&&items.length>0&&(key==='cgtn'?items.every(item=>/^https:\/\/radio-res\.cgtn\.com\//.test(item.audio||'')):key==='six'?items.every(item=>/^https:\/\/downloads\.bbc\.co\.uk\//.test(item.audio||'')):true);return fresh&&stable?items:null}catch(_){return null}}
  function writeFeedCache(key,items){try{const all=JSON.parse(localStorage.getItem(FEED_CACHE_KEY)||'{}');all[key]={at:Date.now(),items};localStorage.setItem(FEED_CACHE_KEY,JSON.stringify(all))}catch(_){}}
  async function loadFeed(key){
    const feed=FEEDS[key],box=$('#bbcEpisodes');if(!feed||!box)return;activateDailyTab(key);$('#bbcFeedNote').textContent=feed.note;box.innerHTML=`<div class="empty">正在读取${feed.domestic?'国内':'海外'}听力…</div>`;
    let items=readFeedCache(key);
    if(!items){try{items=await bundledEpisodes(key);if(!items.length)throw Error('本地节目缓存为空');writeFeedCache(key,items);}catch(_){items=null;}}
    if(!items&&feed.rss){try{const response=await fetch(feed.rss,{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const xml=new DOMParser().parseFromString(await response.text(),'application/xml');items=Array.from(xml.querySelectorAll('item')).slice(0,8).map(item=>{const enclosure=Array.from(item.children).find(el=>el.localName==='enclosureSecure')||item.querySelector('enclosure');const description=item.querySelector('description')?.textContent||'';const holder=document.createElement('div');holder.innerHTML=description;return{title:item.querySelector('title')?.textContent||'BBC episode',date:item.querySelector('pubDate')?.textContent||'',description:(holder.textContent||'').trim().slice(0,240),audio:(enclosure?.getAttribute('url')||'').replace(/^http:/,'https:'),link:(item.querySelector('link')?.textContent||feed.page).replace(/^http:/,'https:'),guid:item.querySelector('guid')?.textContent||''}}).filter(x=>x.audio);if(!items.length)throw Error('RSS 中没有音频');writeFeedCache(key,items);}catch(_){items=key==='six'?FALLBACK_EPISODES:[];}}
    if(!items?.length){renderLocalListening('国内新闻音频暂时不可用，已切换到本机免联网听力。');return;}
    const sourceLabel=feed.domestic?'CGTN 国内官方音频':'BBC 海外音频';
    box.innerHTML=items.map((x,i)=>{const id=x.guid||x.audio,done=state.listenedEpisodes[id];return`<article class="episode"><div class="meta">${esc(formatDate(x.date))}${x.duration?' · '+esc(x.duration):''} · ${sourceLabel}</div><h3>${esc(x.title)}</h3><p class="small muted">${esc(x.description)}</p><button class="btn smallbtn audio-start" type="button" data-audio-start="${i}">▶ 点击播放这条</button><audio controls preload="none" playsinline data-bbc-audio="${i}" data-audio-src="${esc(x.audio)}">当前浏览器不支持音频播放。</audio><div class="audio-help" data-audio-help="${i}" hidden><b>音频加载失败</b><span>${feed.domestic?'当前网络暂时无法连接 CGTN 国内媒体，请重试。':'当前网络可能限制了 BBC 海外媒体，可改用 CGTN 或本机精听。'}</span><div class="smart-actions"><button class="btn smallbtn" type="button" data-audio-retry="${i}">重试播放</button><a class="btn smallbtn" href="${esc(feed.page)}" target="_blank" rel="noopener noreferrer">打开${feed.domestic?'CGTN':'BBC'}官方页 ↗</a><a class="btn smallbtn" href="${esc(x.audio)}" target="_blank" rel="noopener noreferrer">单独打开 MP3 ↗</a></div></div><div class="smart-actions"><a class="btn smallbtn" href="${esc(x.link||feed.page)}" target="_blank" rel="noopener noreferrer">来源页 ↗</a><button class="btn smallbtn ${done?'primary':''}" data-listened="${esc(id)}">${done?'✓ 已完成':'标记听完'}</button></div></article>`}).join('');
    $$('[data-bbc-audio]').forEach(audio=>{const index=audio.dataset.bbcAudio,help=$(`[data-audio-help="${index}"]`),start=$(`[data-audio-start="${index}"]`);let timeout=0;const clearWait=()=>{clearTimeout(timeout);timeout=0},setStart=(text,disabled=false)=>{if(start){start.textContent=text;start.disabled=disabled}},showError=()=>{clearWait();if(help)help.hidden=false;setStart('重试播放')},armTimeout=()=>{clearWait();timeout=setTimeout(()=>{if(audio.readyState<2)showError()},12000)},begin=(reset=false)=>{const src=audio.dataset.audioSrc;if(!src){showError();return}$$('[data-bbc-audio]').forEach(other=>{if(other!==audio&&!other.paused)other.pause()});if(reset||!audio.getAttribute('src')){audio.pause();audio.src=src;audio.load()}if(help)help.hidden=true;setStart('正在连接…',true);armTimeout();audio.play().catch(showError)};audio._bbcBegin=begin;start?.addEventListener('click',()=>begin(false));audio.addEventListener('error',showError);audio.addEventListener('play',armTimeout);audio.addEventListener('stalled',()=>{if(!audio.paused)armTimeout()});audio.addEventListener('playing',()=>{clearWait();if(help)help.hidden=true;setStart('正在播放')});audio.addEventListener('canplay',()=>{clearWait();if(help)help.hidden=true;setStart(audio.paused?'▶ 继续播放':'正在播放')});audio.addEventListener('pause',()=>{if(audio.getAttribute('src')&&!audio.ended)setStart('▶ 继续播放')});audio.addEventListener('ended',()=>setStart('↻ 再听一遍'));});
    $$('[data-audio-retry]').forEach(button=>button.onclick=()=>{const audio=$(`[data-bbc-audio="${button.dataset.audioRetry}"]`);audio?._bbcBegin?.(true);});
    $$('[data-listened]').forEach(button=>button.onclick=()=>{const id=button.dataset.listened;state.listenedEpisodes[id]=!state.listenedEpisodes[id];saveState();button.classList.toggle('primary',state.listenedEpisodes[id]);button.textContent=state.listenedEpisodes[id]?'✓ 已完成':'标记听完';});
  }

  function installQuizAIReview() {
    addEventListener('ielts:quiz-result', event => {
      const d=event.detail||{},form=$('#officialPracticeQuiz'),result=$('#officialQuizResult');if(!form||!result)return;
      form.querySelector('.ai-review-card')?.remove();const card=document.createElement('div');card.className='ai-review-card';
      if(!d.mistakes?.length){card.innerHTML='<b>全对：无需错因复盘。</b><p class="small muted">建议 3 天后限时复做，确认不是短期记忆。</p>';form.appendChild(card);return;}
      card.innerHTML=`<b>AI 错因复盘</b><p class="small muted">已错 ${d.mistakes.length} 题。可粘贴相关原文/听力原句，让 AI 给出更准确的证据链；不粘贴时只做错误模式分析。</p><textarea class="quizEvidence" placeholder="可选：粘贴相关原文或你听到的句子"></textarea><button class="btn primary runQuizReview" type="button">分析错因并安排复习</button><div class="smart-output quizReviewOutput" hidden></div>`;form.appendChild(card);
      card.querySelector('.runQuizReview').onclick=async e=>{if(!requireKey())return;const button=e.currentTarget,out=card.querySelector('.quizReviewOutput'),evidence=card.querySelector('.quizEvidence').value.trim();buttonBusy(button,true,'分析中…','分析错因并安排复习');out.hidden=false;out.textContent='正在按题型、答案差异和证据分类…';try{const prompt=`你是IELTS${d.subject==='listening'?'听力':'阅读'}错因教练。材料 ${d.resource}，得分 ${d.score}/${d.total}。错题：${JSON.stringify(d.mistakes)}。${evidence?'相关原文/听到的句子：'+evidence:'没有提供原文证据；不得声称定位到证据句。'} 请逐题给：错误类型、为什么会选错、一个1-2分钟修复动作。错误类型限于${d.subject==='listening'?'辨音、弱读连读、拼写、单复数、数字日期、词界、干扰项、同义替换、跟丢位置':'同义替换未识别、范围过宽或过窄、相反项、原文正确但答非所问、NG/FALSE混淆、邻近干扰、指代链'}。最后安排1/3/7/14天复习。`;const text=await AI.generateText(prompt,{temperature:.2,maxOutputTokens:2000});out.textContent=text;state.quizReviews.push({at:new Date().toISOString(),...d,evidence,review:text});state.quizReviews=state.quizReviews.slice(-30);saveState();}catch(error){out.textContent='分析失败：'+formatError(error);}finally{buttonBusy(button,false,'','分析错因并安排复习');}};
    });
  }

  installNavigation();
  installBBC();
  installAISettings();
  installSmartBackup();
  installWritingCoach();
  installSpeakingCoach();
  installLegacySpeechUpgrade();
  installQuizAIReview();
})();
