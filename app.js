// ===== EduMind Core App Logic =====
const DEFAULT_API_KEY = 'xai-jZXRNkmc4oqvdTuPJQGbEzcYqcSlbKA0QW5boB8eATpNQShRcUVQnT7O18rE3z7cc6pNddJIeg88BKLL';
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

function getApiKey() {
  try {
    const s = JSON.parse(localStorage.getItem('edumind_settings') || '{}');
    return (s.apiKey && s.apiKey.startsWith('xai-') && s.apiKey.length > 20) ? s.apiKey : DEFAULT_API_KEY;
  } catch { return DEFAULT_API_KEY; }
}

function getModel() {
  try {
    const s = JSON.parse(localStorage.getItem('edumind_settings') || '{}');
    return s.model || 'grok-3-mini';
  } catch { return 'grok-3-mini'; }
}

// ===== STORAGE =====
const Storage = {
  getUser() {
    try { return JSON.parse(localStorage.getItem('edumind_user') || 'null'); } catch { return null; }
  },
  setUser(user) { localStorage.setItem('edumind_user', JSON.stringify(user)); },
  getProfile() {
    try { return JSON.parse(localStorage.getItem('edumind_profile') || 'null'); } catch { return null; }
  },
  setProfile(profile) { localStorage.setItem('edumind_profile', JSON.stringify(profile)); },
  updateProfile(updates) {
    const updated = { ...(this.getProfile() || {}), ...updates, lastActive: new Date().toISOString() };
    this.setProfile(updated);
    return updated;
  },
  getChatHistory(chatId) {
    try { return JSON.parse(localStorage.getItem('edumind_chat_' + chatId) || '[]'); } catch { return []; }
  },
  setChatHistory(chatId, messages) {
    localStorage.setItem('edumind_chat_' + chatId, JSON.stringify(messages));
  },
  getChatList() {
    try { return JSON.parse(localStorage.getItem('edumind_chatlist') || '[]'); } catch { return []; }
  },
  addChatToList(chat) {
    const list = this.getChatList();
    const idx = list.findIndex(c => c.id === chat.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...chat };
    else list.unshift(chat);
    localStorage.setItem('edumind_chatlist', JSON.stringify(list.slice(0, 30)));
  },
  getProgress() {
    try {
      const p = localStorage.getItem('edumind_progress');
      if (p) return JSON.parse(p);
    } catch {}
    return {
      totalSessions: 0, totalHours: 0,
      subjects: { Mathematics: 0, Physics: 0, Chemistry: 0, Biology: 0, English: 0, 'Social Science': 0, Economics: 0, Accountancy: 0 },
      streakDays: 0, lastStudyDate: null,
      weeklyData: [0,0,0,0,0,0,0],
      monthlyScores: [65,70,68,75,72,78],
      completedChapters: [], weakTopics: []
    };
  },
  setProgress(p) { localStorage.setItem('edumind_progress', JSON.stringify(p)); },
  updateProgress(updates) {
    const updated = { ...this.getProgress(), ...updates };
    this.setProgress(updated);
    return updated;
  },
  recordStudySession(subject) {
    const prog = this.getProgress();
    const today = new Date().toDateString();
    const lastDate = prog.lastStudyDate ? new Date(prog.lastStudyDate).toDateString() : null;
    if (lastDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      prog.streakDays = (lastDate === yesterday.toDateString()) ? (prog.streakDays || 0) + 1 : 1;
      prog.lastStudyDate = new Date().toISOString();
    }
    prog.totalSessions = (prog.totalSessions || 0) + 1;
    prog.totalHours = parseFloat(((prog.totalHours || 0) + 0.05).toFixed(2));
    const d = new Date().getDay();
    const idx = d === 0 ? 6 : d - 1; // Mon=0 … Sun=6
    if (!Array.isArray(prog.weeklyData) || prog.weeklyData.length !== 7) prog.weeklyData = [0,0,0,0,0,0,0];
    prog.weeklyData[idx] = parseFloat((prog.weeklyData[idx] + 0.05).toFixed(2));
    if (subject) {
      if (!prog.subjects) prog.subjects = {};
      prog.subjects[subject] = Math.min(100, (prog.subjects[subject] || 0) + 1);
    }
    this.setProgress(prog);
    return prog;
  },
  isLoggedIn() { return !!(this.getUser() && this.getProfile()); },
  logout() {
    localStorage.removeItem('edumind_user');
    localStorage.removeItem('edumind_profile');
  }
};

// ===== SYSTEM PROMPT =====
function buildSystemPrompt(profile, mode) {
  mode = mode || 'doubt';
  const name = (profile && profile.name) ? profile.name : 'Student';
  const cls  = parseInt((profile && profile.studentClass) ? profile.studentClass : '10');
  const stream = (profile && profile.stream) ? profile.stream : null;
  const weak = (profile && Array.isArray(profile.weakTopics) && profile.weakTopics.length) ? profile.weakTopics.join(', ') : 'none yet';
  const done = (profile && Array.isArray(profile.completedChapters) && profile.completedChapters.length) ? profile.completedChapters.join(', ') : 'none yet';

  let level = '';
  if (cls <= 7) level = `Very simple English. Real-life examples (toys, food, sports). No complex formulas unless in Class ${cls} NCERT.`;
  else if (cls <= 9) level = `Simple English. Basic formulas when needed. NCERT Class ${cls} syllabus. Relatable Indian examples.`;
  else if (cls === 10) level = `Board-exam oriented. NCERT Class 10. Solve like CBSE board answers with proper steps. Mention PYQs where applicable.`;
  else if (stream === 'Science') level = `Deep concepts. Derivations, numericals, advanced theory. Mention JEE/NEET relevance. Proper mathematical notation.`;
  else if (stream === 'Commerce') level = `Business context. Formula-driven for Accountancy & Economics. CA Foundation relevance. Real Indian business examples.`;
  else level = `Conceptual and essay-oriented. Social/historical/literary examples from India. Long-answer writing style.`;

  const modeStr = mode === 'study'
    ? `STUDY MODE: Teach one concept at a time. After each concept, ask ONE check-understanding question. Label topics as "Topic 1:", "Topic 2:", etc.`
    : `DOUBT MODE: Solve step by step. Label as "Step 1:", "Step 2:", etc. End with "Do you want me to explain any step in more detail?"`;

  return `You are EduMind — a warm, expert AI tutor for Indian school students (CBSE/NCERT).

Student: ${name}, Class ${cls}${stream ? ' ' + stream : ''}
Level: ${level}
Mode: ${modeStr}
Weak topics: ${weak}
Completed chapters: ${done}

Rules: Address student by first name. Use **bold** for key terms. Be encouraging. Keep focused. If off-topic, redirect to academics.`;
}

// ===== GROK API =====
async function callGrokAPI(messages, systemPrompt) {
  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getApiKey()}` },
    body: JSON.stringify({
      model: getModel(), max_tokens: 1500, temperature: 0.7,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    })
  });
  if (!response.ok) {
    let msg = `API error ${response.status}`;
    try { const e = await response.json(); msg = e.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  const data = await response.json();
  if (!data.choices?.[0]?.message) throw new Error('Invalid API response');
  return data.choices[0].message.content;
}

// ===== AUTH =====
function requireAuth(redirectTo) {
  if (!Storage.isLoggedIn()) { window.location.href = redirectTo || 'login.html'; return false; }
  return true;
}
function redirectIfLoggedIn(redirectTo) {
  if (Storage.isLoggedIn()) { window.location.href = redirectTo || 'dashboard.html'; return true; }
  return false;
}

// ===== TOAST =====
function showToast(message, type) {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = 'toast' + (type && type !== 'default' ? ' ' + type : '');
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => { t.style.cssText += 'opacity:0;transform:translateX(20px);transition:all 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ===== RENDER TEXT (markdown-like, XSS-safe) =====
function renderText(text) {
  if (!text) return '';
  let o = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  o = o
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6;padding:2px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>')
    .replace(/^### (.*)/gm, '<h4 style="font-size:14px;font-weight:600;margin:10px 0 4px">$1</h4>')
    .replace(/^## (.*)/gm,  '<h3 style="font-size:15px;font-weight:600;margin:12px 0 5px">$1</h3>')
    .replace(/^# (.*)/gm,   '<h2 style="font-size:16px;font-weight:700;margin:14px 0 6px">$1</h2>')
    .replace(/^(\d+)\. (.*)/gm, '<div style="margin:5px 0;padding-left:2px"><span style="font-weight:600;color:var(--purple)">$1.</span> $2</div>')
    .replace(/^[-–•] (.*)/gm, '<div style="margin:4px 0;padding-left:10px">• $1</div>')
    .replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  return o;
}

// ===== NAV USER INFO =====
function populateDashNav() {
  const profile = Storage.getProfile();
  if (!profile) return;
  const name  = profile.name || 'Student';
  const first = name.split(' ')[0];
  const init  = name.charAt(0).toUpperCase();
  const cls   = `Class ${profile.studentClass}${profile.stream ? ' · ' + profile.stream : ''}`;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('nav-avatar', init);
  set('nav-name', first);
  set('nav-class', cls);
}

// ===== MOBILE NAV =====
function initMobileNav() {
  const btn     = document.getElementById('nav-hamburger');
  const overlay = document.getElementById('mobile-nav-overlay');
  const panel   = document.getElementById('mobile-nav-panel');
  if (!btn || !panel) return;
  const toggle = (open) => {
    panel.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('open', open);
  };
  btn.addEventListener('click', () => toggle(!panel.classList.contains('open')));
  if (overlay) overlay.addEventListener('click', () => toggle(false));
  // Close on nav link click
  panel.querySelectorAll('a').forEach(a => a.addEventListener('click', () => toggle(false)));
}

// ===== DATE UTILS =====
function formatDate(iso) {
  if (!iso) return 'Never';
  try { return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return '—'; }
}
function timeAgo(iso) {
  if (!iso) return '';
  try {
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ''; }
}

window.EduMind = { Storage, buildSystemPrompt, callGrokAPI, requireAuth, redirectIfLoggedIn, showToast, renderText, populateDashNav, initMobileNav, formatDate, timeAgo };
