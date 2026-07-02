// GB2G Herald-only intake — slim sibling of intake-app.js.
// Reuses the same server endpoints; renders a fixed 8-stage sequence.
const SESSION_ID = window.GB2G_SESSION_ID || null;
const STORAGE_KEY = SESSION_ID ? `gb2g_intake_${SESSION_ID}` : 'gb2g_intake_herald_v1';

const DEFAULT_STATE = {
  stage: 0,
  startedAt: null,
  contact: { name: '', email: '', company: '' },
  herald: {
    website: { url: '', platform: '', snippetAccess: '' },
    knowledge: { services: '', faqs: '', hours: '', policies: '' },
    voice: { agentName: '', tone: '', avoid: '' },
    leads: { destination: '', contact: '', bookingLink: '' },
  },
  sops: { files: [], pastedText: '', additionalLinks: '' },
  schedule: { slot: null },
  doneAt: null,
};
let state = structuredClone(DEFAULT_STATE);

const STAGES = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'website', label: 'Your website' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'voice', label: 'Voice & name' },
  { id: 'leads', label: 'Leads' },
  { id: 'docs', label: 'Docs' },
  { id: 'schedule', label: 'Kickoff call' },
  { id: 'done', label: 'Done' },
];

// ─── helpers ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// ─── persistence (same contract as intake-app.js) ───────────────────────
let _saveTimer = null;
let _saveInflight = false;

function saveStateLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
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

async function initState() {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) state = { ...structuredClone(DEFAULT_STATE), ...JSON.parse(cached) };
  } catch (e) {}
  if (!state.startedAt) state.startedAt = Date.now();
  render();
  if (!SESSION_ID) return;
  try {
    const res = await fetch(`/api/intake/${SESSION_ID}`);
    if (res.ok) {
      const { state: remoteState } = await res.json();
      if (remoteState && typeof remoteState === 'object' && Object.keys(remoteState).length > 0) {
        state = { ...structuredClone(DEFAULT_STATE), ...remoteState };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        render();
      }
    }
  } catch (e) {}
}

// ─── navigation ──────────────────────────────────────────────────────────
function canAdvance() {
  const id = STAGES[state.stage].id;
  switch (id) {
    case 'welcome':
      return !!(state.contact.name.trim() && state.contact.company.trim()
        && /\S+@\S+\.\S+/.test(state.contact.email));
    case 'website': return !!state.herald.website.url.trim();
    case 'knowledge': return !!state.herald.knowledge.services.trim();
    case 'voice': return !!state.herald.voice.agentName.trim();
    case 'leads': return !!state.herald.leads.destination;
    default: return true;
  }
}

function goTo(idx) {
  if (idx < 0 || idx >= STAGES.length || idx === state.stage) return;
  state.stage = idx;
  saveState();
  render();
}
function next() { if (state.stage < STAGES.length - 1) goTo(state.stage + 1); }
function prev() { if (state.stage > 0) goTo(state.stage - 1); }

// ─── chrome ──────────────────────────────────────────────────────────────
function renderProgress() {
  const wrap = document.getElementById('progress');
  if (!wrap) return;
  wrap.innerHTML = '';
  STAGES.forEach((s, i) => {
    const dot = document.createElement('button');
    dot.className = 'stage-dot' + (i < state.stage ? ' done' : i === state.stage ? ' current' : '');
    dot.title = s.label;
    if (i < state.stage) dot.addEventListener('click', () => goTo(i));
    wrap.appendChild(dot);
  });
}

function actionsHtml(opts = {}) {
  const primary = opts.primaryLabel || 'Continue';
  const isFirst = state.stage === 0;
  return `<div class="actions">
    ${isFirst ? '<span></span>' : '<button class="btn btn-back" id="btn-back"><span class="arrow">→</span> Back</button>'}
    <button class="btn btn-primary" id="btn-next" ${canAdvance() ? '' : 'disabled'}>${esc(primary)} <span class="arrow">→</span></button>
  </div>`;
}

function wireActions(node) {
  const back = node.querySelector('#btn-back');
  if (back) back.addEventListener('click', prev);
  const nxt = node.querySelector('#btn-next');
  if (nxt) nxt.addEventListener('click', () => { if (canAdvance()) next(); });
}

function refreshNext(node) {
  const b = node.querySelector('#btn-next');
  if (b) b.disabled = !canAdvance();
}

function bindText(node, sel, get, set) {
  const input = node.querySelector(sel);
  if (!input) return;
  input.value = get();
  input.addEventListener('input', () => {
    set(input.value);
    saveStateLocal();
    refreshNext(node);
  });
  input.addEventListener('change', () => saveState());
}

function bindPills(node, rowSel, current, onPick) {
  node.querySelectorAll(`${rowSel} .pill`).forEach((p) => {
    if (p.dataset.value === current()) p.classList.add('selected');
    p.addEventListener('click', () => {
      onPick(p.dataset.value);
      node.querySelectorAll(`${rowSel} .pill`).forEach((q) =>
        q.classList.toggle('selected', q.dataset.value === p.dataset.value));
      saveState();
      refreshNext(node);
    });
  });
}

// ─── stages ──────────────────────────────────────────────────────────────
function renderWelcome() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Herald setup</p>
    <h1>Let&rsquo;s stand up your website assistant.</h1>
    <p class="lede">Herald answers your visitors&rsquo; questions, captures leads, and hands the tricky stuff to a human. A few quick questions and we&rsquo;ll have everything we need — about five minutes.</p>
    <div class="form-row">
      <div class="field"><label>Your name <span class="req">*</span></label><input id="f-name" type="text" autocomplete="name" /></div>
      <div class="field"><label>Company <span class="req">*</span></label><input id="f-company" type="text" autocomplete="organization" /></div>
    </div>
    <div class="field">
      <label>Email <span class="req">*</span></label>
      <input id="f-email" type="email" autocomplete="email" />
      <p class="hint">We&rsquo;ll send your GB2G portal invite here when you finish.</p>
    </div>
    ${actionsHtml({ primaryLabel: "Let's go" })}
  </div>`);
  bindText(node, '#f-name', () => state.contact.name, (v) => { state.contact.name = v; });
  bindText(node, '#f-company', () => state.contact.company, (v) => { state.contact.company = v; });
  bindText(node, '#f-email', () => state.contact.email, (v) => { state.contact.email = v; });
  wireActions(node);
  return node;
}

function renderWebsite() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Your website</p>
    <h1>Where will Herald live?</h1>
    <p class="lede">Herald sits on your site as a chat widget — one small code snippet and it&rsquo;s live.</p>
    <div class="field"><label>Website URL <span class="req">*</span></label><input id="f-url" type="url" placeholder="https://" autocomplete="url" /></div>
    <div class="field">
      <label>Platform</label>
      <div class="pill-row" id="row-platform">
        ${['Squarespace', 'WordPress', 'Shopify', 'Wix', 'Custom', 'Other'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Who can add a code snippet to the site?</label>
      <div class="pill-row" id="row-snippet">
        ${['I can', 'My web person can', 'Not sure'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
      <p class="hint">Not sure is fine — we&rsquo;ll walk you through it on the kickoff call.</p>
    </div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-url', () => state.herald.website.url, (v) => { state.herald.website.url = v; });
  bindPills(node, '#row-platform', () => state.herald.website.platform, (v) => { state.herald.website.platform = v; });
  bindPills(node, '#row-snippet', () => state.herald.website.snippetAccess, (v) => { state.herald.website.snippetAccess = v; });
  wireActions(node);
  return node;
}

function renderKnowledge() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Knowledge</p>
    <h1>What should your assistant know?</h1>
    <p class="lede">Plain language is perfect — bullet points, quick notes, whatever you&rsquo;d tell a new hire on day one.</p>
    <div class="field"><label>Products &amp; services <span class="req">*</span></label><textarea id="f-services" placeholder="What do you sell or do? Rough pricing if you share it publicly."></textarea></div>
    <div class="field"><label>Top questions customers ask</label><textarea id="f-faqs" placeholder="The 3–10 questions you answer over and over."></textarea></div>
    <div class="field"><label>Hours &amp; location</label><textarea id="f-hours" placeholder="Business hours, service area, address if relevant."></textarea></div>
    <div class="field"><label>Key policies</label><textarea id="f-policies" placeholder="Returns, cancellations, guarantees — anything Herald should get exactly right."></textarea></div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-services', () => state.herald.knowledge.services, (v) => { state.herald.knowledge.services = v; });
  bindText(node, '#f-faqs', () => state.herald.knowledge.faqs, (v) => { state.herald.knowledge.faqs = v; });
  bindText(node, '#f-hours', () => state.herald.knowledge.hours, (v) => { state.herald.knowledge.hours = v; });
  bindText(node, '#f-policies', () => state.herald.knowledge.policies, (v) => { state.herald.knowledge.policies = v; });
  wireActions(node);
  return node;
}

function renderVoice() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Voice &amp; name</p>
    <h1>Give it a name and a voice.</h1>
    <p class="lede">This is what your visitors see in the chat window — make it yours.</p>
    <div class="field">
      <label>Assistant name <span class="req">*</span></label>
      <input id="f-agent-name" type="text" placeholder="e.g. Sunny, Scout, or just Herald" />
      <p class="hint">Shows up in the chat header and your dashboard.</p>
    </div>
    <div class="field">
      <label>Tone</label>
      <div class="pill-row" id="row-tone">
        ${['Friendly', 'Professional', 'Playful'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Words or topics to avoid</label><textarea id="f-avoid" placeholder="Anything Herald should never say or promise."></textarea></div>
    ${actionsHtml()}
  </div>`);
  bindText(node, '#f-agent-name', () => state.herald.voice.agentName, (v) => { state.herald.voice.agentName = v; });
  bindPills(node, '#row-tone', () => state.herald.voice.tone, (v) => { state.herald.voice.tone = v; });
  bindText(node, '#f-avoid', () => state.herald.voice.avoid, (v) => { state.herald.voice.avoid = v; });
  wireActions(node);
  return node;
}

function renderLeads() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Leads &amp; escalation</p>
    <h1>Where should the hot leads go?</h1>
    <p class="lede">When Herald captures a lead or hits a question it shouldn&rsquo;t answer alone, it hands off to you.</p>
    <div class="field">
      <label>Send leads &amp; escalations to <span class="req">*</span></label>
      <div class="pill-row" id="row-dest">
        ${['Email', 'SMS', 'Slack'].map((p) =>
          `<button type="button" class="pill" data-value="${p}">${p}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Who handles them?</label><input id="f-lead-contact" type="text" placeholder="Name, email, or phone for the person on point" /></div>
    <div class="field">
      <label>Booking link to offer visitors</label>
      <input id="f-booking" type="url" placeholder="https:// (Calendly, Acuity — optional)" />
      <p class="hint">If set, Herald can offer visitors a time on your calendar.</p>
    </div>
    ${actionsHtml()}
  </div>`);
  bindPills(node, '#row-dest', () => state.herald.leads.destination, (v) => { state.herald.leads.destination = v; });
  bindText(node, '#f-lead-contact', () => state.herald.leads.contact, (v) => { state.herald.leads.contact = v; });
  bindText(node, '#f-booking', () => state.herald.leads.bookingLink, (v) => { state.herald.leads.bookingLink = v; });
  wireActions(node);
  return node;
}

function renderFileList(node) {
  const list = node.querySelector('#file-list');
  if (!list) return;
  list.innerHTML = state.sops.files.map((f) =>
    `<div class="file-row"><span>${esc(f.name)}</span><span class="meta">${humanSize(f.size)}${f.fileId ? ' · uploaded' : ' · uploading…'}</span></div>`
  ).join('');
}

async function handleFiles(node, fileList) {
  for (const file of fileList) {
    if (file.size > 25 * 1024 * 1024) { alert(`${file.name} is over the 25MB limit.`); continue; }
    state.sops.files.push({ name: file.name, size: file.size, type: file.type, addedAt: Date.now(), fileId: null });
    saveStateLocal();
    renderFileList(node);
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
      const idx = state.sops.files.findIndex((f) => f.name === file.name && !f.fileId);
      if (idx >= 0) { state.sops.files[idx].fileId = fileId; saveState(); renderFileList(node); }
    } catch (e) { console.error('File upload failed:', e); }
  }
}

function renderDocs() {
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Docs</p>
    <h1>Got docs? Hand them over.</h1>
    <p class="lede">FAQ sheets, price lists, policy docs — anything Herald can learn from. All optional.</p>
    <div class="drop" id="drop">
      <input id="file-input" type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,.rtf" hidden />
      <p><strong>Drop files here</strong></p>
      <p class="hint">PDF, Word, or text · up to 25MB each</p>
      <button type="button" class="btn btn-ghost" id="pick-files">Choose files</button>
    </div>
    <div id="file-list"></div>
    <div class="field" style="margin-top:22px"><label>Or paste it in</label><textarea id="f-pasted" placeholder="Paste FAQs, policies, anything useful."></textarea></div>
    <div class="field"><label>Helpful links</label><input id="f-links" type="text" placeholder="Help center, menu, pricing page — comma-separated" /></div>
    ${actionsHtml()}
  </div>`);
  const input = node.querySelector('#file-input');
  node.querySelector('#pick-files').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles(node, Array.from(input.files || [])); input.value = ''; });
  const drop = node.querySelector('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    handleFiles(node, Array.from(e.dataTransfer?.files || []));
  });
  renderFileList(node);
  bindText(node, '#f-pasted', () => state.sops.pastedText, (v) => { state.sops.pastedText = v; });
  bindText(node, '#f-links', () => state.sops.additionalLinks, (v) => { state.sops.additionalLinks = v; });
  wireActions(node);
  return node;
}

function onCalendlyEvent(e) {
  if (e.data && e.data.event === 'calendly.event_scheduled') {
    const payload = e.data.payload || {};
    state.schedule.slot = payload.event?.start_time
      ? new Date(payload.event.start_time).getTime().toString()
      : Date.now().toString();
    saveState();
    render();
  }
}

function renderSchedule() {
  const calendlyUrl = window.GB2G_CALENDLY_URL || 'https://calendly.com/gb2g/intake-kickoff';
  const booked = state.schedule.slot
    ? `<p class="hint" style="margin-bottom:18px">✓ Booked for ${esc(new Date(parseInt(state.schedule.slot)).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>`
    : '';
  const node = el(`<div class="stage-wrap">
    <p class="eyebrow">Kickoff call</p>
    <h1>Grab a kickoff slot.</h1>
    <p class="lede">Twenty minutes with John to confirm the details and set your go-live date. You can also skip and book later.</p>
    ${booked}
    <div class="calendly-inline-widget" data-url="${esc(calendlyUrl)}?hide_gdpr_banner=1&primary_color=C9A961" style="min-width:320px;height:660px;"></div>
    ${actionsHtml({ primaryLabel: state.schedule.slot ? 'Continue' : 'Skip for now' })}
  </div>`);
  if (!document.getElementById('calendly-script')) {
    const s = document.createElement('script');
    s.id = 'calendly-script';
    s.src = 'https://assets.calendly.com/assets/external/widget.js';
    s.async = true;
    document.head.appendChild(s);
  }
  window.removeEventListener('message', onCalendlyEvent);
  window.addEventListener('message', onCalendlyEvent);
  wireActions(node);
  return node;
}

async function submitIntake() {
  if (!SESSION_ID) return;
  try {
    await fetch(`/api/intake/${SESSION_ID}/submit`, { method: 'POST' });
  } catch (e) { console.error('Submit failed:', e); }
}

function renderDone() {
  if (!state.doneAt) {
    state.doneAt = Date.now();
    saveStateLocal();
    submitIntake();
  }
  const h = state.herald;
  const slotLabel = state.schedule.slot
    ? new Date(parseInt(state.schedule.slot)).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Not booked yet';
  const docsCount = state.sops.files.length;
  const node = el(`<div class="stage-wrap done-hero">
    <div class="done-icon">✓</div>
    <p class="eyebrow">All set</p>
    <h1>${esc(h.voice.agentName || 'Herald')} is on the way.</h1>
    <p class="lede" style="margin:0 auto 8px">We&rsquo;ve got everything we need. Watch <strong>${esc(state.contact.email)}</strong> for your GB2G portal invite — your assistant build starts now.</p>
    <div class="summary">
      <div class="summary-row"><span class="key">Assistant</span><span>${esc(h.voice.agentName || '—')}${h.voice.tone ? ' · ' + esc(h.voice.tone) : ''}</span></div>
      <div class="summary-row"><span class="key">Website</span><span>${esc(h.website.url || '—')}</span></div>
      <div class="summary-row"><span class="key">Leads go to</span><span>${esc(h.leads.destination || '—')}${h.leads.contact ? ' · ' + esc(h.leads.contact) : ''}</span></div>
      <div class="summary-row"><span class="key">Docs shared</span><span>${docsCount ? docsCount + ' file' + (docsCount === 1 ? '' : 's') : 'None'}</span></div>
      <div class="summary-row"><span class="key">Kickoff call</span><span>${esc(slotLabel)}</span></div>
    </div>
    <div class="verse-closer">
      &ldquo;Whatever you do, work at it with all your heart, as working for the Lord.&rdquo;
      <span class="ref">Colossians 3:23</span>
    </div>
    <footer class="done-foot"><a href="https://gb2gllc.com">← Back to GB2GLLC</a></footer>
  </div>`);
  return node;
}

// ─── render root ─────────────────────────────────────────────────────────
const RENDERERS = {
  welcome: renderWelcome,
  website: renderWebsite,
  knowledge: renderKnowledge,
  voice: renderVoice,
  leads: renderLeads,
  docs: renderDocs,
  schedule: renderSchedule,
  done: renderDone,
};

function render() {
  renderProgress();
  const main = document.getElementById('main');
  if (!main) return;
  main.innerHTML = '';
  main.appendChild(RENDERERS[STAGES[state.stage].id]());
  window.scrollTo({ top: 0 });
}

// ─── bootstrap ───────────────────────────────────────────────────────────
window.next = next;
window.prev = prev;

const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    if (!dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('gb2g_theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
}

initState();
