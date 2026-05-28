'use strict';

const state = {
  appType: 'auto',
  style: 'playful',
  currentApp: null,
  versions: []
};

const generationSteps = [
  '理解需求',
  '生成 Spec',
  '规划文件结构',
  '编写代码',
  '构建应用',
  '运行测试',
  '生成预览'
];

const homeView = document.querySelector('#homeView');
const progressView = document.querySelector('#progressView');
const previewView = document.querySelector('#previewView');
const promptForm = document.querySelector('#promptForm');
const promptInput = document.querySelector('#promptInput');
const progressPrompt = document.querySelector('#progressPrompt');
const progressSteps = document.querySelector('#progressSteps');
const previewFrame = document.querySelector('#appPreview');
const previewTitle = document.querySelector('#previewTitle');
const specOutput = document.querySelector('#specOutput');
const testOutput = document.querySelector('#testOutput');
const modifyForm = document.querySelector('#modifyForm');
const modifyInput = document.querySelector('#modifyInput');
const versionList = document.querySelector('#versionList');
const toast = document.querySelector('#toast');

document.querySelectorAll('[data-app-type]').forEach((button) => {
  button.addEventListener('click', () => {
    state.appType = button.dataset.appType;
    setActive('[data-app-type]', button);
  });
});

document.querySelectorAll('[data-style]').forEach((button) => {
  button.addEventListener('click', () => {
    state.style = button.dataset.style;
    setActive('[data-style]', button);
  });
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    promptInput.value = button.dataset.prompt;
    promptInput.focus();
  });
});

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

document.querySelector('#backHomeFromProgress').addEventListener('click', showHome);
document.querySelector('#newAppButton').addEventListener('click', showHome);
document.querySelector('#galleryButton').addEventListener('click', () => {
  showToast('作品广场会在 V0.4 加入，现在先从一个想法开始。');
});
document.querySelector('#shareButton').addEventListener('click', shareApp);

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('先写一句想法，我来帮你锻造成应用。');
    return;
  }
  startGeneration(prompt, false);
});

modifyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = modifyInput.value.trim();
  if (!prompt) {
    showToast('告诉 AI 想改哪里，比如风格、难度、按钮或文案。');
    return;
  }
  startGeneration(prompt, true);
  modifyInput.value = '';
});

function startGeneration(prompt, isModification) {
  showProgress(prompt);
  renderProgress(0);

  let index = 0;
  const timer = setInterval(() => {
    index += 1;
    renderProgress(index);

    if (index >= generationSteps.length) {
      clearInterval(timer);
      const app = forgeApp(prompt, isModification);
      state.currentApp = app;
      state.versions.unshift({
        id: app.version,
        title: app.name,
        note: isModification ? prompt : '初始生成',
        createdAt: new Date().toLocaleTimeString()
      });
      renderPreview(app);
    }
  }, 360);
}

function forgeApp(prompt, isModification) {
  const inferredType = inferType(prompt);
  const appType = state.appType === 'auto' ? inferredType : state.appType;
  const previous = state.currentApp;
  const version = `v${state.versions.length + 1}`;
  const name = inferName(prompt, appType, previous);
  const spec = createSpec({ prompt, appType, name, version, isModification });

  return {
    appType,
    name,
    prompt,
    version,
    spec,
    tests: createTests(appType),
    html: appType === 'game'
      ? renderGameApp(spec)
      : renderToolApp(spec)
  };
}

function inferType(prompt) {
  const gameWords = ['游戏', '躲避', '闯关', '分数', '玩家', '敌人', '碰撞', '像素', '关卡', '2048'];
  return gameWords.some((word) => prompt.includes(word)) ? 'game' : 'tool';
}

function inferName(prompt, appType, previous) {
  if (prompt.includes('预算')) return '旅行预算计算器';
  if (prompt.includes('抽奖')) return '抽奖转盘';
  if (prompt.includes('番茄')) return '番茄钟';
  if (prompt.includes('bug') || prompt.includes('Bug')) return 'Bug Dodge';
  if (prompt.includes('修改') && previous) return previous.name;
  return appType === 'game' ? 'Mini Game Forge' : 'Smart Tool Forge';
}

function createSpec({ prompt, appType, name, version, isModification }) {
  const styleLabel = {
    playful: '活泼',
    clean: '简洁',
    pixel: '像素',
    fresh: '清新'
  }[state.style];

  if (appType === 'game') {
    return {
      version,
      appType,
      name,
      sourcePrompt: prompt,
      changeType: isModification ? 'modify' : 'create',
      goal: '让用户快速体验一个轻量、可玩的浏览器小游戏。',
      style: styleLabel,
      mechanics: ['开始游戏', '控制角色移动', '躲避障碍', '获得分数', '重新开始'],
      controls: ['键盘方向键', '触摸按钮'],
      screens: ['start', 'playing', 'gameOver'],
      tests: ['页面可打开', '开始按钮可点击', '分数会变化', '重新开始可用']
    };
  }

  return {
    version,
    appType,
    name,
    sourcePrompt: prompt,
    changeType: isModification ? 'modify' : 'create',
    goal: '让用户快速获得一个实用、移动端友好的浏览器小工具。',
    style: styleLabel,
    features: ['输入参数', '实时计算', '结果摘要', '重置数据'],
    persistence: 'localStorage',
    tests: ['页面可打开', '输入框可用', '计算结果正确', '重置按钮可用']
  };
}

function createTests(appType) {
  const common = [
    ['Build Test', '静态页面生成成功'],
    ['Smoke Test', '预览页面非空且核心控件可见'],
    ['Responsive Test', '移动端宽度下布局不溢出']
  ];

  if (appType === 'game') {
    return common.concat([
      ['Behavior Test', '开始、得分、结束和重新开始状态存在']
    ]);
  }

  return common.concat([
    ['Behavior Test', '输入数值后能得到计算反馈']
  ]);
}

function renderToolApp(spec) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;min-height:100vh;background:#f8fbfb;color:#172026;font-family:Inter,"Segoe UI","Microsoft YaHei",Arial,sans-serif;display:grid;place-items:center;padding:18px}
    main{width:min(520px,100%);border:1px solid #d8e0e5;border-radius:8px;background:white;padding:22px;box-shadow:0 18px 50px rgba(21,35,43,.14)}
    h1{margin:0 0 8px;font-size:28px}p{color:#62707c;line-height:1.5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
    label{display:grid;gap:6px;color:#62707c;font-weight:700;font-size:13px}input{border:1px solid #d8e0e5;border-radius:8px;padding:11px;font:inherit}
    button{border:0;border-radius:8px;padding:12px 14px;background:#172026;color:#fff;font-weight:800;font:inherit;cursor:pointer}.reset{background:#eef4f5;color:#172026}
    .actions{display:flex;gap:10px}.result{margin-top:18px;border-radius:8px;background:#eaf7f2;padding:16px}.big{font-size:34px;font-weight:900;color:#11745e}
    @media(max-width:520px){.grid{grid-template-columns:1fr}.actions{flex-direction:column}}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHTML(spec.name)}</h1>
    <p>${escapeHTML(spec.goal)}</p>
    <section class="grid">
      <label>人数<input id="people" type="number" min="1" value="2"></label>
      <label>天数<input id="days" type="number" min="1" value="3"></label>
      <label>交通费<input id="traffic" type="number" min="0" value="800"></label>
      <label>住宿费<input id="hotel" type="number" min="0" value="1200"></label>
      <label>餐饮费<input id="food" type="number" min="0" value="600"></label>
      <label>娱乐费<input id="fun" type="number" min="0" value="400"></label>
    </section>
    <div class="actions">
      <button id="calculate">计算预算</button>
      <button id="reset" class="reset">重置</button>
    </div>
    <section class="result" aria-live="polite">
      <span>总预算</span>
      <div id="total" class="big">¥3,000</div>
      <p id="average">人均约 ¥1,500</p>
    </section>
  </main>
  <script>
    const ids=['people','days','traffic','hotel','food','fun'];
    function value(id){return Number(document.getElementById(id).value)||0}
    function calculate(){
      const total=value('traffic')+value('hotel')+value('food')+value('fun');
      const people=Math.max(1,value('people'));
      document.getElementById('total').textContent='¥'+total.toLocaleString('zh-CN');
      document.getElementById('average').textContent='人均约 ¥'+Math.round(total/people).toLocaleString('zh-CN');
      localStorage.setItem('app-forge-budget', JSON.stringify(Object.fromEntries(ids.map(id=>[id,value(id)]))));
    }
    document.getElementById('calculate').addEventListener('click', calculate);
    document.getElementById('reset').addEventListener('click',()=>{ids.forEach(id=>document.getElementById(id).value=id==='people'?2:id==='days'?3:0);calculate()});
    ids.forEach(id=>document.getElementById(id).addEventListener('input', calculate));
    calculate();
  </script>
</body>
</html>`;
}

function renderGameApp(spec) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{margin:0;min-height:100vh;background:#101820;color:#f8fbfb;font-family:Inter,"Segoe UI","Microsoft YaHei",Arial,sans-serif;display:grid;place-items:center;padding:14px}
    main{width:min(560px,100%)}.hud{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    h1{margin:0;font-size:26px}.score{font-weight:900;color:#f5b84b}.stage{position:relative;overflow:hidden;height:520px;border:2px solid #2d4655;border-radius:8px;background:linear-gradient(#142631,#0f1820)}
    .player,.bug,.coffee{position:absolute;border-radius:6px}.player{width:42px;height:42px;left:calc(50% - 21px);bottom:24px;background:#21a67a;box-shadow:inset 0 -8px #11745e}
    .bug{width:30px;height:30px;background:#f26d5b}.coffee{width:24px;height:30px;background:#f5b84b;border-radius:5px 5px 10px 10px}
    .overlay{position:absolute;inset:0;display:grid;place-items:center;background:rgba(16,24,32,.72);text-align:center;padding:18px}.overlay.hidden{display:none}
    button{border:0;border-radius:8px;padding:12px 16px;background:#f8fbfb;color:#101820;font-weight:900;font:inherit;cursor:pointer}.controls{display:flex;gap:10px;margin-top:10px}
    .controls button{flex:1;background:#203644;color:#fff}@media(max-width:560px){.stage{height:460px}}
  </style>
</head>
<body>
  <main>
    <div class="hud"><h1>${escapeHTML(spec.name)}</h1><div class="score">Score <span id="score">0</span></div></div>
    <section id="stage" class="stage" aria-label="游戏区域">
      <div id="player" class="player"></div>
      <div id="overlay" class="overlay">
        <div><h2>躲开 bug，收集咖啡</h2><p>方向键或下方按钮移动。</p><button id="start">开始游戏</button></div>
      </div>
    </section>
    <div class="controls"><button id="left">←</button><button id="right">→</button></div>
  </main>
  <script>
    const stage=document.getElementById('stage'), player=document.getElementById('player'), overlay=document.getElementById('overlay'), scoreEl=document.getElementById('score');
    let running=false, x=250, score=0, items=[], loopId=null;
    function start(){running=true;score=0;x=stage.clientWidth/2-21;items.forEach(i=>i.el.remove());items=[];overlay.classList.add('hidden');tick()}
    function end(){running=false;cancelAnimationFrame(loopId);overlay.classList.remove('hidden');overlay.innerHTML='<div><h2>本轮得分 '+score+'</h2><p>AI 已经生成了开始、得分、结束和重开流程。</p><button id="restart">重新开始</button></div>';document.getElementById('restart').onclick=start}
    function move(dx){x=Math.max(0,Math.min(stage.clientWidth-42,x+dx));player.style.left=x+'px'}
    function spawn(){const el=document.createElement('div');const coffee=Math.random()<.22;el.className=coffee?'coffee':'bug';el.style.left=Math.random()*(stage.clientWidth-34)+'px';el.style.top='-36px';stage.appendChild(el);items.push({el,y:-36,coffee})}
    function hit(a,b){const r1=a.getBoundingClientRect(),r2=b.getBoundingClientRect();return !(r1.right<r2.left||r1.left>r2.right||r1.bottom<r2.top||r1.top>r2.bottom)}
    function tick(){if(!running)return;score++;scoreEl.textContent=score;if(score%28===0)spawn();items.forEach(item=>{item.y+=3+score/500;item.el.style.top=item.y+'px';if(hit(player,item.el)){if(item.coffee){score+=120;item.el.remove();item.dead=true}else end()}});items=items.filter(i=>!i.dead&&i.y<stage.clientHeight+40);loopId=requestAnimationFrame(tick)}
    document.getElementById('start').onclick=start;document.getElementById('left').onclick=()=>move(-34);document.getElementById('right').onclick=()=>move(34);
    addEventListener('keydown',e=>{if(e.key==='ArrowLeft')move(-34);if(e.key==='ArrowRight')move(34)});
  </script>
</body>
</html>`;
}

function renderPreview(app) {
  previewTitle.textContent = `${app.name} · ${app.version}`;
  previewFrame.srcdoc = app.html;
  specOutput.textContent = JSON.stringify(app.spec, null, 2);
  testOutput.innerHTML = app.tests.map(([name, detail]) => `
    <div class="test-item">
      <strong>${escapeHTML(name)} ✓</strong>
      <span>${escapeHTML(detail)}</span>
    </div>
  `).join('');
  renderVersions();
  showView(previewView);
}

function renderVersions() {
  versionList.innerHTML = state.versions.map((version) => `
    <div class="version-item">
      <strong>${escapeHTML(version.id)} · ${escapeHTML(version.title)}</strong>
      <span>${escapeHTML(version.createdAt)} · ${escapeHTML(version.note)}</span>
    </div>
  `).join('');
}

function showProgress(prompt) {
  progressPrompt.textContent = prompt;
  showView(progressView);
}

function renderProgress(activeIndex) {
  progressSteps.innerHTML = generationSteps.map((step, index) => {
    const done = index < activeIndex;
    const active = index === activeIndex;
    const className = done ? 'done' : active ? 'active' : '';
    const stateText = done ? '完成' : active ? '进行中' : '等待';
    return `
      <li class="progress-step ${className}">
        <span class="step-dot">${done ? '✓' : index + 1}</span>
        <strong>${step}</strong>
        <span class="step-state">${stateText}</span>
      </li>
    `;
  }).join('');
}

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
  document.querySelector(`#${name}Tab`).classList.remove('hidden');
}

function shareApp() {
  const fakeUrl = `${location.origin}/share/${state.currentApp ? state.currentApp.name.toLowerCase().replaceAll(' ', '-') : 'demo'}`;
  navigator.clipboard?.writeText(fakeUrl);
  showToast(`分享链接已生成：${fakeUrl}`);
}

function showHome() {
  showView(homeView);
}

function showView(view) {
  [homeView, progressView, previewView].forEach((item) => item.classList.add('hidden'));
  view.classList.remove('hidden');
}

function setActive(selector, activeButton) {
  document.querySelectorAll(selector).forEach((button) => button.classList.remove('active'));
  activeButton.classList.add('active');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
