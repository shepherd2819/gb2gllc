// =================== SESSION ===================
const SESSION_ID = window.GB2G_SESSION_ID || null;
const STORAGE_KEY = SESSION_ID ? `gb2g_intake_${SESSION_ID}` : 'gb2g_intake_v1';

// =================== STATE ===================
const DEFAULT_STATE = {
  stage: 0,
  startedAt: null,
  // Path selector: 'braindump' | 'structured' | null (not chosen yet)
  path: null,
  brain_dump_text: '',
  brain_dump_extracted_at: null,
  brain_dump_missing: [],
  brain_dump_confidence: { low: [], high: [] },
  // 1 — basics
  contact: { name: '', email: '', company: '', website: '' },
  // 2 — about
  about: { role: '', industry: '', teamSize: '', urgency: '' },
  // 3 — goals
  goals: { selected: [], freeText: '' },
  // 4 — software
  software: { selected: [], other: '' },
  // 5 — access (per platform: { granted, contactPerson, notes })
  access: {},
  // 6 — sops / docs
  sops: { files: [], pastedText: '', additionalLinks: '' },
  // 7 — tasks
  tasks: [],
  // 8 — schedule
  schedule: { slot: null, weekOffset: 0 },
  // 9 — done
  doneAt: null,
};

let state = structuredClone(DEFAULT_STATE);
let _saveTimer = null;
let _saveInflight = false;

async function initState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...structuredClone(DEFAULT_STATE), ...parsed };
      render();
    }
  } catch (e) { /* ignore */ }

  if (!SESSION_ID) { render(); return; }

  try {
    const res = await fetch(`/api/intake/${SESSION_ID}`);
    if (res.ok) {
      const { state: remoteState } = await res.json();
      if (remoteState && typeof remoteState === 'object') {
        state = { ...structuredClone(DEFAULT_STATE), ...remoteState };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        render();
      }
    }
  } catch (e) {
    console.warn('Could not load remote state, using local:', e);
  }
}

function saveStateLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  const status = document.getElementById('save-status');
  if (status) status.textContent = 'Auto-saved';
}

function saveState() {
  saveStateLocal();
  if (!SESSION_ID) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (_saveInflight) return;
    _saveInflight = true;
    const status = document.getElementById('save-status');
    if (status) status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/intake/${SESSION_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      if (res.ok && status) status.textContent = 'Saved';
    } catch (e) {
      if (status) status.textContent = 'Auto-saved (offline)';
    } finally {
      _saveInflight = false;
    }
  }, 800);
}

function update(updater) {
  updater(state);
  saveState();
  render();
}

// =================== STAGES ===================
// Two flows: brain-dump (faster) and structured (classic). Both share the
// later stages (access, sops, schedule). The brain-dump flow inserts a
// 'braindump' + 'review' pair right after path selection and skips the
// about/goals/software/tasks stages (which the brain dump fills automatically).
const STAGES_FULL = [
  { id: 'welcome',  label: '01 · Welcome',         short: 'Welcome' },
  { id: 'path',     label: '02 · How to start',    short: 'Start' },
  { id: 'braindump',label: '03 · Brain dump',      short: 'Dump',     paths: ['braindump'] },
  { id: 'review',   label: '04 · Review',          short: 'Review',   paths: ['braindump'] },
  { id: 'about',    label: '03 · About you',       short: 'About',    paths: ['structured'] },
  { id: 'goals',    label: '04 · Goals',           short: 'Goals',    paths: ['structured'] },
  { id: 'software', label: '05 · Software stack',  short: 'Stack',    paths: ['structured'] },
  { id: 'tasks',    label: '06 · Top tasks',       short: 'Tasks',    paths: ['structured'] },
  { id: 'access',   label: '07 · Granting access', short: 'Access' },
  { id: 'sops',     label: '08 · SOPs & docs',     short: 'SOPs' },
  { id: 'schedule', label: '09 · Schedule call',   short: 'Schedule' },
  { id: 'done',     label: '10 · Done',            short: 'Done' },
];

function buildActiveStages() {
  const path = state.path;
  return STAGES_FULL.filter((s) => !s.paths || (path && s.paths.includes(path)));
}
// Acts like the old `STAGES` array so the rest of the file keeps working.
// Recomputes on every read so changing state.path immediately re-routes.
const STAGES = new Proxy({}, {
  get(_t, prop) {
    const arr = buildActiveStages();
    if (prop === 'length') return arr.length;
    if (prop === Symbol.iterator) return arr[Symbol.iterator].bind(arr);
    if (typeof arr[prop] === 'function') return arr[prop].bind(arr);
    return arr[prop];
  },
});

const HERALD_CONTEXT = {
  welcome: {
    msg: `Welcome — I'm Herald, your intake assistant. I'll walk you through about 8 short steps so the team behind me knows everything we need <em>before</em> we ever bother you again. Start with the basics on the right.`,
    tip: `Most folks finish in 12–18 minutes.`,
  },
  path: {
    msg: `Two ways to do this. <strong>Brain dump</strong> lets you type or speak everything that's on your mind — I'll pull it into the right places for you to review. <strong>Structured</strong> walks you stage-by-stage. The brain dump is faster if you already know what you want.`,
    tip: `Both end up in the same place — pick whatever feels less like work.`,
  },
  braindump: {
    msg: `Just write what's on your mind. What does your business do, what are you stuck on, what would feel like real help. You can hit the mic and talk if you'd rather. Then I'll organize the rest.`,
    tip: `4–6 sentences is plenty. Don't worry about being organized — that's my job.`,
  },
  review: {
    msg: `Here's what I pulled from what you said. Look it over, fix anything I got wrong, and we'll move on. The original is on the left so you can compare.`,
    tip: `Yellow tags mean low confidence — worth double-checking those.`,
  },
  about: {
    msg: `Quick context on you and your team. This shapes how we scope. There's no wrong answer — if you're a one-person shop, say so.`,
    tip: `"Team size" includes everyone who'd interact with the AI.`,
  },
  goals: {
    msg: `Tell me the headline. What's the one outcome that would make this engagement <em>obviously</em> worth it? Pick a few + add free text — I'll suggest specific use cases on the next step.`,
    tip: `Concrete is better. "Save 8 hours a week on intake" beats "improve operations."`,
  },
  software: {
    msg: `Tap every tool your team uses. We won't ask you to give us access to every single one — but knowing what's in your stack lets us suggest where AI fits without disrupting anything.`,
    tip: `Don't see a tool? Add it under "Other" at the bottom.`,
  },
  access: {
    msg: `For each platform you picked, I have step-by-step instructions on exactly how to give our dev team access — with the minimum permissions needed. Expand any card, follow the steps, then check it off. You can skip and do this later.`,
    tip: `We use <strong>devs@gb2g.com</strong> as our team email.`,
  },
  sops: {
    msg: `Drop in any SOPs, internal docs, FAQs, or process notes. These let our Steward agents answer questions like you would. <em>Skip if you don't have any</em> — totally fine.`,
    tip: `PDFs, Word docs, plain text, and Markdown all work. 25MB max per file.`,
  },
  tasks: {
    msg: `The most important step. List 3–5 specific tasks you'd want AI to handle. Be granular — "draft Monday morning team update from Linear + Slack activity" beats "automate reporting."`,
    tip: `For each task, jot the frequency, who does it now, and where the data lives.`,
  },
  schedule: {
    msg: `Pick a time for a 20-minute kickoff call. We'll walk through everything you've shared, confirm what we heard, and tell you what we'll deliver — and what we won't.`,
    tip: `Times are in your local timezone.`,
  },
  done: {
    msg: `That's it. We have everything we need. <em>Thank you</em> — and we mean that.`,
    tip: `Save the link or your packet — you can revisit this any time.`,
  },
};

// =================== RENDER ROOT ===================
function render(opts = {}) {
  renderProgress();
  renderHerald();
  const main = document.getElementById('main');
  const stageId = STAGES[state.stage].id;
  main.innerHTML = '';
  const stageNode = renderStage(stageId);
  stageNode.classList.add('stage-wrap');
  // direction-aware enter offset
  const dir = opts.direction || 'forward';
  stageNode.style.setProperty('--enter-y', dir === 'back' ? '-16px' : '16px');
  main.appendChild(stageNode);

  // Stagger the field reveals based on order in the document
  const animated = stageNode.querySelectorAll(
    '.field, .platform-grid, .access-list, .access-progress, .drop-zone, .file-list, .task-list, .add-task-btn, .calendar, .insight, .summary, .done-actions, .verse-closer'
  );
  animated.forEach((el, i) => {
    el.style.setProperty('--field-delay', (0.06 + i * 0.035) + 's');
  });

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderProgress() {
  const el = document.getElementById('progress');
  el.innerHTML = '';
  STAGES.forEach((s, i) => {
    const dot = document.createElement('div');
    dot.className = 'stage-dot';
    if (i < state.stage) dot.classList.add('done');
    if (i === state.stage) dot.classList.add('current');
    const tip = document.createElement('span');
    tip.className = 'stage-tooltip';
    tip.textContent = s.short;
    dot.appendChild(tip);
    // Allow click-back to previously-visited stages
    if (i <= state.stage) {
      dot.addEventListener('click', () => goTo(i));
    }
    el.appendChild(dot);
  });
}

function renderHerald() {
  const el = document.getElementById('herald-context');
  const ctx = HERALD_CONTEXT[STAGES[state.stage].id];
  el.innerHTML = `
    <div class="herald-msg intro">${ctx.msg}</div>
    <div class="herald-msg">${ctx.tip}</div>
  `;
}

// =================== NAV ===================
function goTo(stageIdx, opts = {}) {
  if (stageIdx < 0 || stageIdx >= STAGES.length) return;
  if (stageIdx === state.stage) return;

  const direction = stageIdx > state.stage ? 'forward' : 'back';
  const main = document.getElementById('main');
  const current = main.firstElementChild;

  // Respect prefers-reduced-motion
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (current && !reduce) {
    // Fade out current
    current.style.setProperty('--exit-y', direction === 'forward' ? '-10px' : '10px');
    current.classList.add('exit');
    setTimeout(() => {
      state.stage = stageIdx;
      saveState();
      render({ direction });
    }, 200);
  } else {
    state.stage = stageIdx;
    saveState();
    render({ direction });
  }
}

function next() { goTo(state.stage + 1); }
function prev() { goTo(state.stage - 1); }

function canAdvance() {
  const id = STAGES[state.stage].id;
  if (id === 'welcome') {
    const c = state.contact;
    return c.name.trim() && c.email.trim() && c.company.trim() && /\S+@\S+\.\S+/.test(c.email);
  }
  if (id === 'about') {
    return state.about.role.trim() && state.about.industry && state.about.teamSize;
  }
  if (id === 'goals') {
    return state.goals.selected.length > 0 || state.goals.freeText.trim();
  }
  if (id === 'software') {
    return state.software.selected.length > 0 || state.software.other.trim();
  }
  if (id === 'access') {
    return true; // optional
  }
  if (id === 'sops') {
    return true; // optional
  }
  if (id === 'tasks') {
    return state.tasks.some(t => t.name && t.name.trim());
  }
  if (id === 'schedule') {
    return true; // Calendly handles slot selection; allow skip
  }
  return true;
}

// =================== STAGE RENDERERS ===================
function renderStage(id) {
  const renderers = {
    welcome: renderWelcome,
    path: renderPath,
    braindump: renderBrainDump,
    review: renderReview,
    about: renderAbout,
    goals: renderGoals,
    software: renderSoftware,
    access: renderAccess,
    sops: renderSOPs,
    tasks: renderTasks,
    schedule: renderSchedule,
    done: renderDone,
  };
  return renderers[id]();
}

// ----- helpers -----
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function actionsHtml(opts = {}) {
  const isFirst = state.stage === 0;
  const isLast = state.stage === STAGES.length - 1;
  const back = isFirst ? '' : `<button class="btn btn-link btn-back" id="btn-back"><span class="arrow">→</span> Back</button>`;
  let primary = '';
  if (!isLast) {
    primary = `<button class="btn btn-primary" id="btn-next" ${canAdvance() ? '' : 'disabled'}>${opts.primaryLabel || 'Continue'} <span class="arrow">→</span></button>`;
  }
  const skip = opts.canSkip ? `<button class="btn btn-ghost" id="btn-skip">Skip this step</button>` : '';
  return `<div class="actions"><div>${back}</div><div class="right">${skip}${primary}</div></div>`;
}

function wireActions(node) {
  const next = node.querySelector('#btn-next');
  if (next) next.addEventListener('click', () => window.next());
  const back = node.querySelector('#btn-back');
  if (back) back.addEventListener('click', () => window.prev());
  const skip = node.querySelector('#btn-skip');
  if (skip) skip.addEventListener('click', () => window.next());
}

// ============ STAGE 1: WELCOME ============
function renderWelcome() {
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[0].label}</div>
      <h1>Let's get you <em>onboarded</em>.</h1>
      <p class="lede">A few basics so we know who we're talking to and where to find you. Everything else builds from here.</p>
      <div class="form-row">
        <div class="field">
          <label>Your full name <span class="req">*</span></label>
          <input type="text" id="f-name" placeholder="Sarah Lin" value="${esc(state.contact.name)}" />
        </div>
        <div class="field">
          <label>Best email <span class="req">*</span></label>
          <input type="email" id="f-email" placeholder="sarah@yourcompany.com" value="${esc(state.contact.email)}" />
        </div>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Company name <span class="req">*</span></label>
          <input type="text" id="f-company" placeholder="Northwood Clinics" value="${esc(state.contact.company)}" />
        </div>
        <div class="field">
          <label>Website <span style="color:var(--ink-mute);font-weight:400;font-family:var(--sans);text-transform:none;letter-spacing:0;">(if you have one)</span></label>
          <input type="text" id="f-website" placeholder="northwoodclinics.com" value="${esc(state.contact.website)}" />
        </div>
      </div>
      ${actionsHtml()}
    </div>
  `);
  ['name', 'email', 'company', 'website'].forEach(k => {
    const inp = node.querySelector('#f-' + k);
    inp.addEventListener('input', () => {
      state.contact[k] = inp.value;
      saveState();
      const b = node.querySelector('#btn-next');
      if (b) b.disabled = !canAdvance();
    });
  });
  wireActions(node);
  if (!state.startedAt) { state.startedAt = Date.now(); saveState(); }
  return node;
}

// ============ STAGE: PATH SELECTOR ============
function renderPath() {
  const path = state.path;
  const meta = STAGES.find(s => s.id === 'path');
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${meta ? meta.label : 'How to start'}</div>
      <h1>How would you like to do this?</h1>
      <p class="lede">Two ways — pick whichever feels less like work. Both end up in the same place.</p>

      <div class="path-picker">
        <button type="button" class="path-card ${path === 'braindump' ? 'selected' : ''}" data-path="braindump">
          <span class="path-badge">Recommended</span>
          <div class="path-visual">
            <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="6" y="6" width="52" height="36" rx="6"/>
              <path d="M14 18 h36 M14 26 h28 M14 34 h22"/>
              <circle cx="50" cy="38" r="5" fill="currentColor" opacity="0.18"/>
              <path d="M48 38 l1.5 1.5 L52 36" stroke="currentColor" stroke-width="1.6"/>
            </svg>
          </div>
          <div class="path-title">Brain dump</div>
          <div class="path-desc">Type or speak everything that's on your mind — I'll organize it into the right places for you to review.</div>
          <div class="path-meta">~4 min · 1 textarea</div>
        </button>

        <button type="button" class="path-card ${path === 'structured' ? 'selected' : ''}" data-path="structured">
          <div class="path-visual">
            <svg viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="10" r="3"/>
              <path d="M20 10 h36"/>
              <circle cx="12" cy="24" r="3"/>
              <path d="M20 24 h28"/>
              <circle cx="12" cy="38" r="3"/>
              <path d="M20 38 h22"/>
              <path d="M12 13 v8 M12 27 v8" opacity="0.4"/>
            </svg>
          </div>
          <div class="path-title">Structured walk-through</div>
          <div class="path-desc">I'll guide you stage by stage with focused questions. Slower, more thorough, no surprises.</div>
          <div class="path-meta">~12 min · 8 stages</div>
        </button>
      </div>

      ${actionsHtml({ primaryLabel: 'Continue' })}
    </div>
  `);
  node.querySelectorAll('.path-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const chosen = card.dataset.path;
      update(s => { s.path = chosen; });
    });
  });
  wireActions(node);
  return node;
}

// ============ STAGE: BRAIN DUMP ============
function renderBrainDump() {
  const meta = STAGES.find(s => s.id === 'braindump');
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${meta ? meta.label : 'Brain dump'}</div>
      <h1>Tell me <em>everything</em>.</h1>
      <p class="lede">What does your business do? What's eating your time? What would feel like real help? Don't worry about being organized — that's my job.</p>

      <div class="braindump-wrap">
        <textarea id="bd-text" class="braindump-text" placeholder="e.g. We run a real-estate photo & video studio in Charleston. Three shooters, two editors. We get most of our jobs through agents who book through Spiro. The thing that kills us is the back-and-forth on cancellations and rescheduling — feels like 6 hours a week between three of us. I'd love an AI that handles the rebook flow and sends follow-ups for canceled shoots.">${esc(state.brain_dump_text)}</textarea>
        <div class="braindump-toolbar">
          <button type="button" class="braindump-mic" id="bd-mic" title="Voice input" aria-label="Toggle voice input">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3"/>
              <path d="M5 11a7 7 0 0 0 14 0"/>
              <path d="M12 18v3"/>
              <path d="M9 21h6"/>
            </svg>
            <span class="bd-mic-label">Talk</span>
          </button>
          <div class="braindump-count" id="bd-count">0 chars</div>
        </div>
      </div>

      <div class="braindump-error" id="bd-error" style="display:none;"></div>

      ${actionsHtml({ primaryLabel: 'Organize this for me' })}
    </div>
  `);

  const ta = node.querySelector('#bd-text');
  const count = node.querySelector('#bd-count');
  const mic = node.querySelector('#bd-mic');
  const micLabel = node.querySelector('.bd-mic-label');
  const err = node.querySelector('#bd-error');
  const nextBtn = node.querySelector('#btn-next');

  function refreshCount() {
    const n = (ta.value || '').length;
    count.textContent = `${n.toLocaleString()} chars` + (n < 20 ? ' · at least 20 needed' : '');
    if (nextBtn) nextBtn.disabled = n < 20;
  }
  refreshCount();
  ta.addEventListener('input', () => {
    state.brain_dump_text = ta.value;
    saveStateLocal();
    refreshCount();
  });

  // ── Voice input (Web Speech API) ────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    mic.style.display = 'none';
  } else {
    let rec = null;
    let listening = false;
    mic.addEventListener('click', () => {
      if (listening) { rec.stop(); return; }
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      let baseText = ta.value;
      if (baseText && !baseText.endsWith(' ') && !baseText.endsWith('\n')) baseText += ' ';
      rec.onresult = (evt) => {
        let final = '', interim = '';
        for (let i = evt.resultIndex; i < evt.results.length; i++) {
          const t = evt.results[i][0].transcript;
          if (evt.results[i].isFinal) final += t + ' ';
          else interim += t;
        }
        ta.value = baseText + final + interim;
        if (final) baseText += final;
        state.brain_dump_text = ta.value;
        saveStateLocal();
        refreshCount();
      };
      rec.onerror = (e) => { console.warn('Speech recognition error', e); stop(); };
      rec.onend = stop;
      rec.start();
      listening = true;
      mic.classList.add('listening');
      micLabel.textContent = 'Stop';
    });
    function stop() {
      listening = false;
      mic.classList.remove('listening');
      micLabel.textContent = 'Talk';
    }
  }

  // ── Submit: hijack the next button to call /braindump first ─────
  if (nextBtn) {
    nextBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = (ta.value || '').trim();
      if (text.length < 20) return;
      nextBtn.disabled = true;
      nextBtn.textContent = 'Organizing…';
      err.style.display = 'none';
      try {
        const res = await fetch(`/api/intake/${SESSION_ID}/braindump`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to organize');
        // Merge extracted into local state. Preserve existing contact (the
        // welcome stage already collected name/email/company/website) but
        // fill in anything still blank.
        const ex = data.extracted;
        update(s => {
          s.contact.name    = s.contact.name    || ex.contact.name;
          s.contact.email   = s.contact.email   || ex.contact.email;
          s.contact.company = s.contact.company || ex.contact.company;
          s.contact.website = s.contact.website || ex.contact.website;
          s.about = ex.about;
          s.goals = ex.goals;
          s.software = ex.software;
          s.tasks = ex.tasks;
          s.brain_dump_text = text;
          s.brain_dump_extracted_at = new Date().toISOString();
          s.brain_dump_missing = ex.missing_fields;
          s.brain_dump_confidence = ex.confidence;
          s.stage = s.stage + 1;
        });
      } catch (e2) {
        err.textContent = e2.message;
        err.style.display = 'block';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Organize this for me';
      }
    }, { capture: true });
  }
  // No wireActions() — we hijacked next ourselves
  const back = node.querySelector('#btn-back');
  if (back) back.addEventListener('click', () => window.prev());
  return node;
}

// ============ STAGE: REVIEW (after brain dump) ============
function renderReview() {
  const meta = STAGES.find(s => s.id === 'review');
  const conf = state.brain_dump_confidence || { low: [], high: [] };
  const isLow = (path) => conf.low.includes(path);

  function fieldRow(path, label, value, type = 'text') {
    const lowTag = isLow(path) ? `<span class="rv-tag rv-low" title="Low confidence — please double-check">check</span>` : '';
    const input = type === 'textarea'
      ? `<textarea class="rv-input" data-path="${path}" rows="2">${esc(value || '')}</textarea>`
      : `<input class="rv-input" data-path="${path}" type="text" value="${esc(value || '')}" />`;
    return `
      <div class="rv-row">
        <label>${label} ${lowTag}</label>
        ${input}
      </div>
    `;
  }

  const tasksHtml = (state.tasks || []).map((t, i) => `
    <div class="rv-task">
      <input class="rv-input rv-task-input" data-task-idx="${i}" data-task-field="title" value="${esc(t.title || '')}" placeholder="Task title" />
      <input class="rv-input rv-task-sub"   data-task-idx="${i}" data-task-field="frequency" value="${esc(t.frequency || '')}" placeholder="How often?" />
      <input class="rv-input rv-task-sub"   data-task-idx="${i}" data-task-field="whoDoesItNow" value="${esc(t.whoDoesItNow || '')}" placeholder="Who handles it now?" />
      <input class="rv-input rv-task-sub"   data-task-idx="${i}" data-task-field="dataLives" value="${esc(t.dataLives || '')}" placeholder="Where does the data live?" />
    </div>
  `).join('');

  const missingHtml = (state.brain_dump_missing || []).length > 0
    ? `<div class="rv-missing"><strong>Couldn't infer:</strong> ${(state.brain_dump_missing || []).map(esc).join(', ')}. You can fill these in if they matter.</div>`
    : '';

  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${meta ? meta.label : 'Review'}</div>
      <h1>Here's what I <em>heard</em>.</h1>
      <p class="lede">Edit anything I got wrong. Yellow tags mean low confidence. Original is on the left.</p>

      ${missingHtml}

      <div class="review-grid">
        <div class="review-source">
          <div class="rv-source-label">Your brain dump</div>
          <div class="rv-source-text">${esc(state.brain_dump_text || '')}</div>
        </div>

        <div class="review-extracted">
          <h3 class="rv-section">About you</h3>
          <div class="rv-grid-2">
            ${fieldRow('contact.name', 'Name', state.contact.name)}
            ${fieldRow('contact.email', 'Email', state.contact.email)}
            ${fieldRow('contact.company', 'Company', state.contact.company)}
            ${fieldRow('contact.website', 'Website', state.contact.website)}
            ${fieldRow('about.role', 'Your role', state.about.role)}
            ${fieldRow('about.industry', 'Industry', state.about.industry)}
            ${fieldRow('about.teamSize', 'Team size', state.about.teamSize)}
            ${fieldRow('about.urgency', 'Urgency', state.about.urgency)}
          </div>

          <h3 class="rv-section">Goals & stack</h3>
          ${fieldRow('goals.freeText', 'Goals in your words', state.goals.freeText, 'textarea')}
          <div class="rv-row">
            <label>Goal tags <span class="rv-helper">(auto-picked)</span></label>
            <div class="rv-chips">${(state.goals.selected || []).map(g => `<span class="rv-chip">${esc(g)}</span>`).join('') || '<span class="rv-empty">none picked yet — adjust in the next stages</span>'}</div>
          </div>
          <div class="rv-row">
            <label>Software you use</label>
            <div class="rv-chips">${(state.software.selected || []).map(g => `<span class="rv-chip">${esc(g)}</span>`).join('') || '<span class="rv-empty">none picked yet</span>'}</div>
          </div>
          ${fieldRow('software.other', 'Other software', state.software.other)}

          <h3 class="rv-section">Tasks you'd want AI to handle</h3>
          ${tasksHtml || '<div class="rv-empty">No specific tasks pulled. You can add them in the next stages if you want.</div>'}
        </div>
      </div>

      ${actionsHtml({ primaryLabel: 'Looks good — continue' })}
    </div>
  `);

  // Wire field edits — write back to state on input
  node.querySelectorAll('.rv-input[data-path]').forEach(inp => {
    inp.addEventListener('input', () => {
      const path = inp.dataset.path.split('.');
      let cursor = state;
      for (let i = 0; i < path.length - 1; i++) cursor = cursor[path[i]];
      cursor[path[path.length - 1]] = inp.value;
      saveStateLocal();
    });
  });
  // Wire task edits
  node.querySelectorAll('.rv-task-input, .rv-task-sub').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = parseInt(inp.dataset.taskIdx, 10);
      const f = inp.dataset.taskField;
      if (!state.tasks[i]) return;
      state.tasks[i][f] = inp.value;
      saveStateLocal();
    });
  });

  wireActions(node);
  return node;
}

// ============ STAGE 2: ABOUT ============
function renderAbout() {
  const teamSizes = ['Just me', '2–10', '11–50', '51–200', '200+'];
  const urgencies = ['ASAP — yesterday', 'Within 30 days', '1–3 months out', 'Just exploring'];
  const industries = [
    'Healthcare / clinics', 'Professional services', 'Real estate', 'E-commerce',
    'SaaS / tech', 'Education', 'Construction / trades', 'Hospitality / F&B',
    'Non-profit / ministry', 'Manufacturing', 'Financial services', 'Other'
  ];
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[1].label}</div>
      <h1>About <em>you</em>.</h1>
      <p class="lede">Helps us scope the engagement. Who's the buyer, who's affected, and how urgent is this.</p>

      <div class="field">
        <label>Your role <span class="req">*</span></label>
        <input type="text" id="f-role" placeholder="Founder / CEO / Operations Manager" value="${esc(state.about.role)}" />
      </div>

      <div class="field">
        <label>Industry <span class="req">*</span></label>
        <select id="f-industry">
          <option value="">Select…</option>
          ${industries.map(i => `<option value="${esc(i)}" ${state.about.industry === i ? 'selected' : ''}>${esc(i)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Team size <span class="req">*</span></label>
        <div class="radio-row" id="team-size-row">
          ${teamSizes.map(t => `<div class="pill ${state.about.teamSize === t ? 'selected' : ''}" data-val="${esc(t)}"><span class="check">✓</span>${esc(t)}</div>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>How urgent</label>
        <div class="radio-row" id="urgency-row">
          ${urgencies.map(u => `<div class="pill ${state.about.urgency === u ? 'selected' : ''}" data-val="${esc(u)}"><span class="check">✓</span>${esc(u)}</div>`).join('')}
        </div>
      </div>

      ${actionsHtml()}
    </div>
  `);

  node.querySelector('#f-role').addEventListener('input', e => {
    state.about.role = e.target.value;
    saveState();
    const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
  });
  node.querySelector('#f-industry').addEventListener('change', e => {
    state.about.industry = e.target.value;
    saveState();
    const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
  });
  node.querySelectorAll('#team-size-row .pill').forEach(p => {
    p.addEventListener('click', () => {
      state.about.teamSize = p.dataset.val;
      saveState(); render();
    });
  });
  node.querySelectorAll('#urgency-row .pill').forEach(p => {
    p.addEventListener('click', () => {
      state.about.urgency = p.dataset.val;
      saveState(); render();
    });
  });
  wireActions(node);
  return node;
}

// ============ STAGE 3: GOALS ============
function renderGoals() {
  const goalsList = [
    'Save time on customer questions',
    'Qualify more inbound leads',
    'Book more meetings',
    'Automate internal reporting',
    'Draft + summarize documents',
    'Build / redesign our website',
    'Reduce manual data entry',
    'Improve response speed',
    'Handle support tier 1',
    'Onboard new clients faster',
    'Triage email & inbox',
    'Other (describe below)',
  ];
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[2].label}</div>
      <h1>What are you <em>trying to solve</em>?</h1>
      <p class="lede">Pick all that fit. After this step Herald will suggest specific use cases for your situation.</p>

      <div class="field">
        <label>Outcomes you'd like</label>
        <div class="check-row" id="goals-row">
          ${goalsList.map(g => `<div class="pill ${state.goals.selected.includes(g) ? 'selected' : ''}" data-val="${esc(g)}"><span class="check">✓</span>${esc(g)}</div>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>In your own words</label>
        <textarea id="f-goals-text" placeholder="If you could wave a wand, what changes about how your team operates 6 months from now?">${esc(state.goals.freeText)}</textarea>
      </div>

      ${actionsHtml()}
    </div>
  `);
  node.querySelectorAll('#goals-row .pill').forEach(p => {
    p.addEventListener('click', () => {
      const v = p.dataset.val;
      const idx = state.goals.selected.indexOf(v);
      if (idx >= 0) state.goals.selected.splice(idx, 1);
      else state.goals.selected.push(v);
      saveState(); render();
    });
  });
  node.querySelector('#f-goals-text').addEventListener('input', e => {
    state.goals.freeText = e.target.value;
    saveState();
    const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
  });
  wireActions(node);
  return node;
}

// ============ STAGE 4: SOFTWARE ============
function renderSoftware() {
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[3].label}</div>
      <h1>Your <em>software stack</em>.</h1>
      <p class="lede">Tap every tool your team uses regularly. Don't worry about which ones we'll need access to — we'll sort that on the next step.</p>

      ${state.goals.selected.length || state.goals.freeText ? `
        <div class="insight" id="goals-insight">
          <div class="icon">i</div>
          <div class="body">
            <h5>Herald · based on your goals</h5>
            <p id="insight-text">Generating recommendations…</p>
          </div>
        </div>
      ` : ''}

      <div class="platform-grid" id="platform-grid">
        ${PLATFORMS.map(p => `
          <div class="platform-card ${state.software.selected.includes(p.id) ? 'selected' : ''}" data-id="${p.id}" data-sec="${p.sensitivity}">
            <div class="checkmark"></div>
            <div class="name">${esc(p.name)}</div>
            <div class="desc">${esc(p.desc)}</div>
            <div class="meta-row">
              <span>${esc(p.category)}</span>
              <span class="sec"><span class="sec-dot"></span>${p.sensitivity}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="field">
        <label>Anything we missed?</label>
        <textarea id="f-other" placeholder="Other tools — one per line">${esc(state.software.other)}</textarea>
        <div class="hint">e.g. internal tools, custom CRMs, vendor portals</div>
      </div>

      ${actionsHtml()}
    </div>
  `);
  node.querySelectorAll('#platform-grid .platform-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const idx = state.software.selected.indexOf(id);
      if (idx >= 0) {
        state.software.selected.splice(idx, 1);
        delete state.access[id];
      } else {
        state.software.selected.push(id);
        if (!state.access[id]) state.access[id] = { granted: false };
      }
      saveState();
      card.classList.toggle('selected');
      const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
    });
  });
  node.querySelector('#f-other').addEventListener('input', e => {
    state.software.other = e.target.value;
    saveState();
    const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
  });
  wireActions(node);

  // Trigger Herald insight
  if (state.goals.selected.length || state.goals.freeText) {
    generateGoalsInsight(node.querySelector('#insight-text'));
  }
  return node;
}

// ============ STAGE 5: ACCESS ============
function renderAccess() {
  const selected = PLATFORMS.filter(p => state.software.selected.includes(p.id));
  const grantedCount = selected.filter(p => state.access[p.id]?.granted).length;
  const total = selected.length;
  const pct = total ? (grantedCount / total) * 100 : 0;

  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[4].label}</div>
      <h1>Granting <em>access</em>.</h1>
      <p class="lede">For each tool, follow the steps. Use the minimum permissions we list — never give us more than we need. You can skip this entirely and do it later.</p>

      ${total === 0 ? `
        <div class="insight">
          <div class="icon">i</div>
          <div class="body">
            <h5>Nothing to grant yet</h5>
            <p>You didn't select any platforms on the last step. Go back to add some, or skip ahead.</p>
          </div>
        </div>
      ` : `
        <div class="access-progress">
          <div class="label">Access granted</div>
          <div class="bar"><div class="fill" style="width:${pct}%;"></div></div>
          <div class="count">${grantedCount} / ${total}</div>
        </div>

        <div class="access-list" id="access-list">
          ${selected.map(p => renderAccessCard(p)).join('')}
        </div>
      `}

      ${actionsHtml({ canSkip: true })}
    </div>
  `);

  node.querySelectorAll('.access-card').forEach(card => {
    const head = card.querySelector('.access-head');
    head.addEventListener('click', e => {
      // Don't toggle when clicking the done-check
      if (e.target.classList.contains('done-check')) return;
      card.classList.toggle('open');
    });
    const check = card.querySelector('.done-check');
    check.addEventListener('click', e => {
      e.stopPropagation();
      const id = card.dataset.id;
      state.access[id] = state.access[id] || {};
      state.access[id].granted = !state.access[id].granted;
      saveState();
      render();
    });
    const send = card.querySelector('.send-instructions');
    if (send) {
      send.addEventListener('click', e => {
        e.stopPropagation();
        const id = card.dataset.id;
        const platform = PLATFORMS.find(p => p.id === id);
        emailInstructions(platform);
      });
    }
  });
  wireActions(node);
  return node;
}

function renderAccessCard(p) {
  const acc = state.access[p.id] || {};
  return `
    <div class="access-card ${acc.granted ? 'done' : ''}" data-id="${p.id}">
      <div class="access-head">
        <div class="left">
          <div class="done-check"></div>
          <div>
            <div class="name">${esc(p.name)}</div>
            <div class="meta">${esc(p.desc)} · ${esc(p.timeEstimate)} · ${esc(p.permissionsNeeded)}</div>
          </div>
        </div>
        <div class="right">
          <span class="chip ${p.sensitivity}">${p.sensitivity} sensitivity</span>
          <span class="toggle">▼</span>
        </div>
      </div>
      <div class="access-body">
        <div class="needed"><strong>Who can do this:</strong> ${esc(p.permissionsNeeded)}. <strong>Time:</strong> ~${esc(p.timeEstimate)}.</div>
        <ol>
          ${p.steps.map(s => `<li>${s}</li>`).join('')}
        </ol>
        <div class="confirm-row">
          <a class="send-instructions">↗ Email these steps to a teammate</a>
          <span style="font-family:var(--mono);font-size:11px;color:var(--ink-mute);">Done? Tap the checkbox to the left.</span>
        </div>
      </div>
    </div>
  `;
}

// ============ STAGE 6: SOPS ============
function renderSOPs() {
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[5].label}</div>
      <h1>Drop in your <em>SOPs & docs</em>.</h1>
      <p class="lede">Anything that explains how your business runs. Our Steward agents will read these so they answer questions the way you would. Skip if you don't have any — totally fine.</p>

      <div class="drop-zone" id="drop-zone">
        <div class="icon">⤓</div>
        <h4>Drag files here or <span class="browse">browse</span></h4>
        <p>PDF · DOCX · TXT · MD · up to 25MB each</p>
        <input type="file" id="file-input" multiple accept=".pdf,.docx,.txt,.md,.doc,.rtf" style="display:none;" />
      </div>

      <div class="file-list" id="file-list">
        ${state.sops.files.map((f, i) => `
          <div class="file-item" data-idx="${i}">
            <div class="icon">${esc(extLabel(f.name))}</div>
            <div class="meta">
              <div class="name">${esc(f.name)}</div>
              <div class="size">${humanSize(f.size)} · uploaded</div>
            </div>
            <span class="tag">${esc(tagFor(f.name))}</span>
            <button class="remove" data-idx="${i}" title="Remove">×</button>
          </div>
        `).join('')}
      </div>

      <div class="field">
        <label>Or paste in process notes</label>
        <textarea id="f-sops-text" placeholder="e.g. &quot;Intake flow: 1. greet, 2. ask reason, 3. check insurance, 4. book slot…&quot;" style="min-height:140px;">${esc(state.sops.pastedText)}</textarea>
      </div>

      <div class="field">
        <label>Links to existing docs</label>
        <textarea id="f-sops-links" placeholder="Notion / Google Doc / Confluence links — one per line">${esc(state.sops.additionalLinks)}</textarea>
        <div class="hint">Make sure they're shared with <strong>devs@gb2g.com</strong> if they require auth.</div>
      </div>

      ${actionsHtml({ canSkip: true })}
    </div>
  `);

  const drop = node.querySelector('#drop-zone');
  const input = node.querySelector('#file-input');
  drop.addEventListener('click', e => {
    if (e.target.classList.contains('browse') || e.target === drop || e.target.tagName !== 'INPUT') input.click();
  });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', e => handleFiles(e.target.files));

  node.querySelectorAll('.file-item .remove').forEach(b => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.idx);
      state.sops.files.splice(i, 1);
      saveState(); render();
    });
  });
  node.querySelector('#f-sops-text').addEventListener('input', e => {
    state.sops.pastedText = e.target.value; saveState();
  });
  node.querySelector('#f-sops-links').addEventListener('input', e => {
    state.sops.additionalLinks = e.target.value; saveState();
  });

  wireActions(node);
  return node;
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (file.size > 25 * 1024 * 1024) {
      alert(`"${file.name}" is over 25MB — please compress it or split it.`);
      continue;
    }
    const localEntry = { name: file.name, size: file.size, type: file.type, addedAt: Date.now(), fileId: null };
    state.sops.files.push(localEntry);
    saveStateLocal();
    render();

    if (!SESSION_ID) continue;
    try {
      const res = await fetch(`/api/intake/${SESSION_ID}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, contentType: file.type, size: file.size }),
      });
      if (!res.ok) { console.error('Upload URL error:', await res.text()); continue; }
      const { fileId, uploadUrl } = await res.json();
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      const idx = state.sops.files.findIndex(f => f.name === file.name && !f.fileId);
      if (idx >= 0) { state.sops.files[idx].fileId = fileId; saveState(); render(); }
    } catch (e) {
      console.error('File upload failed:', e);
    }
  }
}

function extLabel(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ext.substring(0, 4).toUpperCase();
}
function tagFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { pdf: 'document', docx: 'document', doc: 'document', txt: 'notes', md: 'notes', rtf: 'document' };
  return map[ext] || 'file';
}
function humanSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============ STAGE 7: TASKS ============
function renderTasks() {
  if (state.tasks.length === 0) {
    state.tasks = [
      { name: '', desc: '', frequency: '', owner: '', tools: '' }
    ];
  }
  const frequencies = ['', 'Multiple times a day', 'Daily', 'A few times a week', 'Weekly', 'Monthly', 'Quarterly', 'One-off / project-based'];
  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[6].label}</div>
      <h1>The <em>top tasks</em> you want help with.</h1>
      <p class="lede">List 3–5 specific tasks AI should handle. The more concrete, the better. "Draft Monday team update from Linear + Slack" beats "automate reporting."</p>

      <div class="task-list" id="task-list">
        ${state.tasks.map((t, i) => `
          <div class="task-card" data-idx="${i}">
            <div class="task-head">
              <span class="num">Task ${String(i + 1).padStart(2, '0')}</span>
              ${state.tasks.length > 1 ? `<button class="remove-task" data-idx="${i}">× remove</button>` : ''}
            </div>
            <label class="task-name-label">Task name <span class="req">*</span></label>
            <input type="text" class="task-name ${t.name ? '' : 'empty'}" placeholder="e.g. Draft weekly team update from Slack + Linear" value="${esc(t.name)}" data-field="name" data-idx="${i}" />
            <label class="task-desc-label">Describe it</label>
            <textarea class="task-desc" placeholder="What does it look like today? Who does it, where does the data come from, how often?" data-field="desc" data-idx="${i}">${esc(t.desc)}</textarea>
            <div class="task-meta-row">
              <div class="col">
                <label>How often</label>
                <select data-field="frequency" data-idx="${i}">
                  ${frequencies.map(f => `<option value="${esc(f)}" ${t.frequency === f ? 'selected' : ''}>${esc(f) || 'Select…'}</option>`).join('')}
                </select>
              </div>
              <div class="col">
                <label>Who does it now</label>
                <input type="text" data-field="owner" data-idx="${i}" placeholder="e.g. Office manager" value="${esc(t.owner)}" />
              </div>
              <div class="col">
                <label>Tools involved</label>
                <input type="text" data-field="tools" data-idx="${i}" placeholder="e.g. Linear, Slack, Gmail" value="${esc(t.tools)}" />
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      ${!canAdvance() ? '<p class="task-hint">Name at least one task to continue</p>' : ''}
      <button class="add-task-btn" id="add-task">+ Add another task</button>

      ${actionsHtml()}
    </div>
  `);
  node.querySelectorAll('input, textarea, select').forEach(field => {
    const f = field.dataset.field;
    const i = parseInt(field.dataset.idx);
    if (!f || isNaN(i)) return;
    field.addEventListener('input', () => {
      state.tasks[i][f] = field.value;
      if (f === 'name') field.classList.toggle('empty', !field.value.trim());
      saveState();
      const b = node.querySelector('#btn-next'); if (b) b.disabled = !canAdvance();
      const hint = node.querySelector('.task-hint');
      if (hint) hint.style.display = canAdvance() ? 'none' : '';
    });
    field.addEventListener('change', () => {
      state.tasks[i][f] = field.value;
      saveState();
    });
  });
  node.querySelectorAll('.remove-task').forEach(b => {
    b.addEventListener('click', () => {
      const i = parseInt(b.dataset.idx);
      state.tasks.splice(i, 1);
      saveState(); render();
    });
  });
  node.querySelector('#add-task').addEventListener('click', () => {
    if (state.tasks.length >= 8) return;
    state.tasks.push({ name: '', desc: '', frequency: '', owner: '', tools: '' });
    saveState(); render();
  });
  wireActions(node);
  return node;
}

// ============ STAGE 8: SCHEDULE (Calendly) ============
function renderSchedule() {
  const calendlyUrl = window.GB2G_CALENDLY_URL || 'https://calendly.com/gb2g/intake-kickoff';
  const slotConfirmed = state.schedule.slot
    ? new Date(parseInt(state.schedule.slot)).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  const node = el(`
    <div>
      <div class="stage-meta"><span class="dot"></span>${STAGES[7].label}</div>
      <h1>Pick a <em>time</em> for our kickoff.</h1>
      <p class="lede">20 minutes. We will confirm what you have shared, walk through what we will deliver, and make sure we are the right shop for the work.</p>

      <div style="min-height:660px;border-radius:12px;overflow:hidden;margin-bottom:24px;">
        <div class="calendly-inline-widget"
          data-url="${calendlyUrl}?hide_gdpr_banner=1&primary_color=C9A961"
          style="min-width:320px;height:660px;">
        </div>
      </div>

      ${slotConfirmed ? `<div class="insight" style="margin-bottom:24px;"><div class="icon">&#10003;</div><div class="body"><h5>Time selected</h5><p>${slotConfirmed}</p></div></div>` : ''}

      ${actionsHtml({ canSkip: true, primaryLabel: state.schedule.slot ? 'Confirm & continue' : 'Continue' })}
    </div>
  `);

  if (!document.getElementById('calendly-script')) {
    const s = document.createElement('script');
    s.id = 'calendly-script';
    s.src = 'https://assets.calendly.com/assets/external/widget.js';
    s.async = true;
    document.head.appendChild(s);
  }

  function onCalendlyEvent(e) {
    if (e.data && e.data.event === 'calendly.event_scheduled') {
      const payload = e.data.payload || {};
      state.schedule.slot = payload.event && payload.event.start_time
        ? new Date(payload.event.start_time).getTime().toString()
        : Date.now().toString();
      state.schedule.calendlyEventUri = (payload.event && payload.event.uri) || null;
      state.schedule.inviteeUri = (payload.invitee && payload.invitee.uri) || null;
      saveState();
      render();
    }
  }
  window.addEventListener('message', onCalendlyEvent);

  wireActions(node);
  return node;
}

// ============ STAGE 9: DONE ============
function renderDone() {
  if (!state.doneAt) {
    state.doneAt = Date.now();
    saveState();
    submitIntake();
  }

  const selected = PLATFORMS.filter(p => state.software.selected.includes(p.id));
  const grantedCount = selected.filter(p => state.access[p.id]?.granted).length;
  const slotDate = state.schedule.slot ? new Date(parseInt(state.schedule.slot)) : null;
  const slotLabel = slotDate
    ? slotDate.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Not scheduled — we will email options';

  const node = el(`
    <div>
      <div class="done-hero">
        <div class="done-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 L10 18 L20 6"/></svg>
        </div>
        <h1>Intake <em>complete</em>.</h1>
        <p class="lede" style="margin:0 auto;">Thank you, ${esc(state.contact.name.split(' ')[0] || 'friend')}. The team behind me has everything they need.</p>
      </div>

      <div class="summary">
        <h3>Your intake packet</h3>
        <div class="summary-row"><span class="key">Contact</span><span class="val">${esc(state.contact.name)} · ${esc(state.contact.email)}</span></div>
        <div class="summary-row"><span class="key">Company</span><span class="val">${esc(state.contact.company)}${state.contact.website ? ' · ' + esc(state.contact.website) : ''}</span></div>
        <div class="summary-row"><span class="key">Role · industry</span><span class="val">${esc(state.about.role)} · ${esc(state.about.industry)} · team of ${esc(state.about.teamSize)}</span></div>
        ${state.about.urgency ? `<div class="summary-row"><span class="key">Urgency</span><span class="val">${esc(state.about.urgency)}</span></div>` : ''}
        <div class="summary-row">
          <span class="key">Goals</span>
          <span class="val">
            ${state.goals.selected.map(g => `<span class="tag">${esc(g)}</span>`).join('')}
            ${state.goals.freeText ? `<div style="margin-top:8px;font-style:italic;color:var(--ink-soft);font-family:var(--serif);font-size:15px;">"${esc(state.goals.freeText)}"</div>` : ''}
          </span>
        </div>
        <div class="summary-row">
          <span class="key">Software stack</span>
          <span class="val">
            ${selected.map(p => `<span class="tag">${esc(p.name)}</span>`).join('')}
            ${state.software.other ? `<div style="margin-top:8px;font-size:13px;color:var(--ink-soft);">+ ${esc(state.software.other.replace(/\n/g, ', '))}</div>` : ''}
          </span>
        </div>
        <div class="summary-row"><span class="key">Access</span><span class="val">${grantedCount} of ${selected.length} platforms granted</span></div>
        <div class="summary-row"><span class="key">SOPs / docs</span><span class="val">${state.sops.files.length} file${state.sops.files.length === 1 ? '' : 's'}${state.sops.pastedText ? ' + pasted notes' : ''}${state.sops.additionalLinks ? ' + linked docs' : ''}</span></div>
        <div class="summary-row">
          <span class="key">Top tasks</span>
          <span class="val">
            ${state.tasks.filter(t => t.name).map(t => `<div style="margin-bottom:6px;"><strong>${esc(t.name)}</strong>${t.frequency ? ` <span style="color:var(--ink-mute);font-family:var(--mono);font-size:11px;">· ${esc(t.frequency)}</span>` : ''}</div>`).join('')}
          </span>
        </div>
        <div class="summary-row"><span class="key">Kickoff call</span><span class="val">${esc(slotLabel)}</span></div>
      </div>

      <div class="done-actions">
        <button class="btn btn-primary" id="dl-json">Download packet (JSON) <span class="arrow">&#x2193;</span></button>
      </div>

      <div class="verse-closer">
        <div class="verse">"Whatever you do, work at it with all your heart, as working for the Lord."</div>
        <div class="ref">Colossians 3:23 · our anchor</div>
      </div>

      <div class="actions" style="border-top:none;padding-top:24px;margin-top:32px;justify-content:center;gap:16px;">
        <a href="/" class="btn btn-ghost">&#8592; Back to GB2GLLC</a>
        <button class="btn btn-link" id="start-over">Start a new intake</button>
      </div>
    </div>
  `);

  node.querySelector('#dl-json').addEventListener('click', downloadIntake);
  return node;
}

// =================== HELPERS ===================
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function downloadIntake() {
  const packet = buildPacket();
  const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gb2g-intake-${slug(state.contact.company || 'client')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function submitIntake() {
  if (!SESSION_ID) return;
  try {
    await fetch(`/api/intake/${SESSION_ID}/submit`, { method: 'POST' });
  } catch (e) {
    console.error('Submit failed:', e);
  }
}

function emailInstructions(platform) {
  const subject = encodeURIComponent(`How to give GB2G access to ${platform.name}`);
  const stepsText = platform.steps.map((s, i) =>
    `${i + 1}. ${s.replace(/<[^>]+>/g, '')}`
  ).join('\n\n');
  const body = encodeURIComponent(
    `Hi,\n\nCould you walk through these steps to give our GB2G dev team access to ${platform.name}?\n\n` +
    `Who can do this: ${platform.permissionsNeeded}\n` +
    `Time: ~${platform.timeEstimate}\n\n` +
    `${stepsText}\n\n` +
    `Once done, let me know — I will mark it complete in our intake.\n\n` +
    `Thanks!`
  );
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
}

function buildPacket() {
  const selected = PLATFORMS.filter(p => state.software.selected.includes(p.id));
  return {
    sessionId: SESSION_ID,
    submittedAt: new Date().toISOString(),
    contact: state.contact,
    about: state.about,
    goals: state.goals,
    software: {
      platforms: selected.map(p => ({ id: p.id, name: p.name, accessGranted: !!state.access[p.id]?.granted })),
      other: state.software.other,
    },
    sops: {
      filesCount: state.sops.files.length,
      fileNames: state.sops.files.map(f => f.name),
      pastedText: state.sops.pastedText,
      additionalLinks: state.sops.additionalLinks,
    },
    tasks: state.tasks.filter(t => t.name),
    kickoff: state.schedule.slot ? new Date(parseInt(state.schedule.slot)).toISOString() : null,
  };
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'intake';
}

// =================== HERALD AI (SSE) ===================
let goalsInsightLoaded = false;

async function generateGoalsInsight(targetEl) {
  if (!targetEl || goalsInsightLoaded) return;
  try {
    const goalsText = state.goals.selected.join(', ') +
      (state.goals.freeText ? '. In their words: "' + state.goals.freeText + '"' : '');
    const res = await fetch('/api/herald', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID, mode: 'goals-insight', message: goalsText }),
    });
    if (!res.ok || !res.body) {
      targetEl.textContent = 'Once we know your stack, we will recommend specific use cases.';
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    targetEl.textContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') break;
        try { const { token } = JSON.parse(payload); text += token; targetEl.textContent = text; } catch (e) { /* skip */ }
      }
    }
    goalsInsightLoaded = true;
  } catch (e) {
    if (targetEl) targetEl.textContent = 'Recommendations will come during your kickoff call.';
  }
}

// =================== ASK HERALD MODAL (SSE) ===================
const chatHistory = [];

function openModal() {
  const m = document.getElementById('modal');
  m.classList.add('show');
  setTimeout(() => document.getElementById('ask-input').focus(), 100);
  if (chatHistory.length === 0) {
    addChat('herald', 'Hi ' + (state.contact.name.split(' ')[0] || 'there') + ' — ask me anything about the intake, our products, or how we work. I will keep it short.');
  }
}
function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function addChat(who, text, opts) {
  opts = opts || {};
  const body = document.getElementById('chat-body');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + who;
  const av = document.createElement('div');
  av.className = 'av-mini';
  if (who === 'herald') { av.textContent = 'gb'; const two = document.createElement('span'); two.className = 'two'; two.textContent = '2'; av.appendChild(two); const g = document.createTextNode('g'); av.appendChild(g); } else { av.textContent = 'Y'; }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (opts.thinking) {
    const dots = document.createElement('div'); dots.className = 'thinking-dots';
    for (let i = 0; i < 3; i++) { const s = document.createElement('span'); dots.appendChild(s); }
    bubble.appendChild(dots);
  } else {
    bubble.textContent = text;
  }
  div.appendChild(av);
  div.appendChild(bubble);
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
  return div;
}

async function ask(question) {
  if (!question.trim()) return;
  addChat('you', question);
  chatHistory.push({ role: 'user', text: question });
  const thinkingEl = addChat('herald', '', { thinking: true });
  document.getElementById('ask-submit').disabled = true;
  try {
    const res = await fetch('/api/herald', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        mode: 'intake-assist',
        message: question,
        context: { stage: STAGES[state.stage].label, contactName: state.contact.name, company: state.contact.company, selectedGoals: state.goals.selected },
      }),
    });
    let reply = '';
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const bubble = thinkingEl.querySelector('.bubble');
      bubble.textContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;
          try { const { token } = JSON.parse(payload); reply += token; bubble.textContent = reply; document.getElementById('chat-body').scrollTop = document.getElementById('chat-body').scrollHeight; } catch (e) { /* skip */ }
        }
      }
    } else {
      reply = "I can't reach my brain right now — every question will be answered on the kickoff call.";
      thinkingEl.querySelector('.bubble').textContent = reply;
    }
    chatHistory.push({ role: 'herald', text: reply });
  } catch (e) {
    thinkingEl.querySelector('.bubble').textContent = "Sorry — I am offline at the moment. The team will answer on the kickoff call.";
  } finally {
    document.getElementById('ask-submit').disabled = false;
    document.getElementById('ask-input').focus();
  }
}

// =================== BOOTSTRAP ===================
window.next = next;
window.prev = prev;

document.getElementById('ask-btn').addEventListener('click', openModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});
document.getElementById('ask-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('ask-input');
  const q = input.value;
  input.value = '';
  ask(q);
});

initState();
