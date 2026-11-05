'use strict';

const SESSION_KEY = 'studyhub_session_v1';

function parseSession(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const email = String(parsed.email || '').trim().toLowerCase();
    const name = String(parsed.name || '').trim();
    if (!email) return null;
    return { email, name: name || email.split('@')[0] || 'Student' };
  } catch {
    return null;
  }
}

function readSession() {
  return parseSession(sessionStorage.getItem(SESSION_KEY)) || parseSession(localStorage.getItem(SESSION_KEY));
}

const SESSION = readSession();
if (!SESSION) {
  window.location.replace('../index.html');
  throw new Error('Missing session');
}

/* Utils */
const $ = id => document.getElementById(id);
const uKey = k => `${SESSION.email}_${k}`;
const load = (k, d = []) => {
  try {
    const v = localStorage.getItem(uKey(k));
    if (v === null) return d;
    const parsed = JSON.parse(v);
    if (Array.isArray(d)) return Array.isArray(parsed) ? parsed : d;
    if (d && typeof d === 'object') return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : d;
    return parsed;
  } catch {
    return d;
  }
};
const save = (k, v) => localStorage.setItem(uKey(k), JSON.stringify(v));
const esc = v =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const safeColor = v => (/^#[0-9a-f]{6}$/i.test(v) ? v : '#7c3aed');
const ago = ts => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const pad2 = n => String(n).padStart(2, '0');
const dateKeyFromDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dateKeyFromTimestamp = ts => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return dateKeyFromDate(d);
};
const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return dateKeyFromDate(d);
};

/* Data store */
const SETTINGS_DEFAULT = {
  pomodoro: 25,
  shortBreak: 5,
  longBreak: 15,
  autoStartBreaks: false,
  soundEnabled: true
};
const PREFERENCES_DEFAULT = { dailyGoalHours: 2 };

const D = {
  subjects: load('subjects'),
  todos: load('todos'),
  focus: load('focusItems'),
  notes: load('notes'),
  events: load('events'),
  goals: load('goals'),
  pSessions: load('pomodoroSessions'),
  sSessions: load('studySessions'),
  settings: { ...SETTINGS_DEFAULT, ...load('pomodoroSettings', SETTINGS_DEFAULT) },
  assignments: load('assignments'),
  planner: load('plannerSessions'),
  preferences: { ...PREFERENCES_DEFAULT, ...load('preferences', PREFERENCES_DEFAULT) }
};

/* Toast */
const toastEl = $('toast');
let _tt;
function toast(msg, type = 'ok') {
  clearTimeout(_tt);
  $('toastMsg').textContent = msg;
  toastEl.className = `toast ${type} show`;
  _tt = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

/* Modal helpers */
function onModalClosed(id) {
  if (id === 'focusModalWrap') resetFocusModal();
  if (id === 'goalUpdateModalWrap') resetGoalUpdateModal();
  if (id === 'confirmModalWrap') clearConfirmState();
}

const openM = id => {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('open');
};

const closeM = id => {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('open');
  onModalClosed(id);
};

document.querySelectorAll('[data-close]').forEach(b => {
  b.onclick = () => closeM(b.dataset.close);
});

document.querySelectorAll('.mb').forEach(backdrop => {
  backdrop.onclick = e => {
    if (e.target === backdrop) closeM(backdrop.id);
  };
});

/* Confirm modal */
let confirmAction = null;

function clearConfirmState() {
  confirmAction = null;
  const btn = $('confirmModalConfirmBtn');
  if (btn) {
    btn.textContent = 'Confirm';
    btn.className = 'btn btn-p btn-sm';
  }
}

function showConfirm({ title, message, confirmLabel, danger, onConfirm }) {
  $('confirmModalTitle').textContent = title || 'Please confirm';
  $('confirmModalMessage').textContent = message || 'Are you sure?';
  const btn = $('confirmModalConfirmBtn');
  btn.textContent = confirmLabel || 'Confirm';
  btn.className = danger ? 'btn btn-sm btn-danger' : 'btn btn-p btn-sm';
  confirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  openM('confirmModalWrap');
}

$('confirmModalConfirmBtn').onclick = () => {
  const action = confirmAction;
  closeM('confirmModalWrap');
  if (action) action();
};
$('confirmModalCancelBtn').onclick = () => closeM('confirmModalWrap');
$('confirmModalCloseBtn').onclick = () => closeM('confirmModalWrap');

/* Sidebar */
const sidebar = $('sidebar');
$('sidebarToggle').onclick = () => {
  sidebar.classList.toggle('collapsed');
  setTimeout(renderChart, 320);
};
$('mobileToggle').onclick = () => sidebar.classList.toggle('mobile-open');

document.querySelectorAll('.ni[data-s]').forEach(item => {
  item.onclick = () => {
    document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const s = item.dataset.s;
    document.querySelectorAll('.section').forEach(x => x.classList.remove('active'));
    $(`${s}-section`)?.classList.add('active');
    $('pageTitle').textContent = item.querySelector('.nl')?.textContent || s;
    if (window.innerWidth <= 768) sidebar.classList.remove('mobile-open');
    if (s === 'calendar') renderCalendar();
    if (s === 'assignments') renderAssignments();
    if (s === 'analytics') renderAnalytics();
    if (s === 'dashboard') {
      updateDashboard();
      renderChart();
    }
  };
});
document.querySelectorAll('[data-go]').forEach(button => {
  button.onclick = () => document.querySelector(`.ni[data-s="${button.dataset.go}"]`)?.click();
});

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userName');
}

$('logoutBtn').onclick = () => {
  showConfirm({
    title: 'Sign out',
    message: 'Do you want to sign out of this dashboard?',
    confirmLabel: 'Sign out',
    danger: true,
    onConfirm: async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('The server could not end your session.');
        clearSession();
        window.location.href = '../index.html';
      } catch (error) {
        toast(error.message, 'er');
      }
    }
  });
};

/* Theme toggle */
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const btn = $('themeToggle');
  if (theme === 'light') {
    btn.innerHTML = MOON + '<span class="theme-label">Dark</span>';
  } else {
    btn.innerHTML = SUN + '<span class="theme-label">Light</span>';
  }
  const settingsThemeButton = $('settingsThemeToggle');
  if (settingsThemeButton) settingsThemeButton.textContent = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  setTimeout(renderChart, 50);
  setTimeout(renderAnalytics, 50);
}

const savedTheme = localStorage.getItem('theme') || 'dark';
applyTheme(savedTheme);

$('themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
};
$('settingsThemeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
};

$('dailyGoalInput').value = D.preferences.dailyGoalHours;
$('saveDailyGoalBtn').onclick = () => {
  const hours = Number($('dailyGoalInput').value);
  if (!Number.isFinite(hours) || hours < 0.5 || hours > 16) {
    toast('Daily goal must be between 0.5 and 16 hours.', 'er');
    return;
  }
  D.preferences.dailyGoalHours = hours;
  save('preferences', D.preferences);
  updateDashboard();
  toast('Daily study goal saved');
};

/* Backup export/import */
const BACKUP_KEYS = [
  'subjects',
  'todos',
  'focusItems',
  'notes',
  'events',
  'goals',
  'pomodoroSessions',
  'studySessions',
  'pomodoroSettings',
  'assignments',
  'plannerSessions',
  'preferences'
];

function getBackupFilename() {
  const safeEmail = SESSION.email.replace(/[^a-z0-9_.@-]/gi, '_');
  return `studysync-backup-${safeEmail}-${today()}.json`;
}

function buildBackupPayload() {
  const data = {};
  BACKUP_KEYS.forEach(key => {
    const raw = localStorage.getItem(uKey(key));
    if (raw !== null) {
      try {
        data[key] = JSON.parse(raw);
      } catch {
        /* ignore malformed values */
      }
    }
  });
  return {
    version: 1,
    app: 'StudySync',
    exportedAt: Date.now(),
    user: { email: SESSION.email, name: SESSION.name },
    data
  };
}

function hydrateDataFromStorage() {
  D.subjects = load('subjects');
  D.todos = load('todos');
  D.focus = load('focusItems');
  D.notes = load('notes');
  D.events = load('events');
  D.goals = load('goals');
  D.pSessions = load('pomodoroSessions');
  D.sSessions = load('studySessions');
  D.settings = { ...SETTINGS_DEFAULT, ...load('pomodoroSettings', SETTINGS_DEFAULT) };
  D.assignments = load('assignments');
  D.planner = load('plannerSessions');
  D.preferences = { ...PREFERENCES_DEFAULT, ...load('preferences', PREFERENCES_DEFAULT) };
}

function rerenderAll() {
  renderSubjects();
  renderTodos();
  renderNotes();
  renderCalendar();
  renderGoals();
  updatePomStats();
  updateTimer();
  updateDashboard();
  setTimeout(renderChart, 50);
}

$('exportDataBtn').onclick = () => {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getBackupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Backup exported');
};
$('settingsExportBtn').onclick = () => $('exportDataBtn').click();

$('importDataInput').onchange = e => {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    input.value = '';
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result || '{}'));
    } catch {
      toast('Invalid backup file', 'er');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
      toast('Backup file is missing data', 'er');
      return;
    }

    showConfirm({
      title: 'Import backup',
      message: 'This will overwrite current dashboard data for this user.',
      confirmLabel: 'Import',
      danger: true,
      onConfirm: () => {
        BACKUP_KEYS.forEach(key => {
          if (Object.prototype.hasOwnProperty.call(parsed.data, key)) {
            save(key, parsed.data[key]);
          }
        });
        hydrateDataFromStorage();
        rerenderAll();
        toast('Backup imported');
      }
    });
  };
  reader.onerror = () => {
    input.value = '';
    toast('Could not read backup file', 'er');
  };
  reader.readAsText(file);
};
/* Dashboard */
function updateDashboard() {
  const totalMin = D.sSessions.reduce((a, s) => a + (Number(s.duration) || 0), 0);
  const todayMin = D.sSessions
    .filter(s => dateKeyFromTimestamp(s.date) === today())
    .reduce((a, s) => a + (Number(s.duration) || 0), 0);
  const goalMin = Math.max(30, Number(D.preferences.dailyGoalHours) * 60 || 120);
  const goalPct = Math.min(100, Math.round((todayMin / goalMin) * 100));
  $('totalStudyHours').textContent = `${(totalMin / 60).toFixed(1)}h`;
  $('completedTasks').textContent = D.todos.filter(t => t.completed).length;
  $('pendingAssignments').textContent = D.assignments.filter(a => !a.completed).length;
  $('goalsAchieved').textContent = D.goals.filter(g => g.progress === 100).length;
  $('currentStreak').textContent = calcStreak();
  $('todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('todayStudyHours').textContent = todayMin >= 60 ? `${(todayMin / 60).toFixed(1)} hours` : `${todayMin} min`;
  $('dailyGoalLabel').textContent = `Goal: ${D.preferences.dailyGoalHours} ${Number(D.preferences.dailyGoalHours) === 1 ? 'hour' : 'hours'}`;
  $('dailyGoalProgress').style.width = `${goalPct}%`;
  $('dailyGoalPercent').textContent = `${goalPct}%`;
  renderFocus();
  renderActivity();
  renderAssignments();
  renderPlanner();
  renderAnalytics();
}

function renderAssignments() {
  const el = $('assignmentList');
  const pending = D.assignments.filter(a => !a.completed).sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
  const completed = D.assignments.filter(a => a.completed).sort((a, b) => b.completedAt - a.completedAt);
  const ordered = [...pending, ...completed];
  if (!ordered.length) {
    el.innerHTML = '<div class="empty"><span class="ei2">📚</span><span class="et2">No assignments yet</span></div>';
  } else {
    el.innerHTML = ordered.map(a => {
      const dueDate = String(a.dueDate || '');
      const daysLeft = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? Math.ceil((new Date(`${dueDate}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000) : null;
      const urgency = a.completed ? 'completed' : daysLeft !== null && daysLeft < 0 ? 'overdue' : daysLeft !== null && daysLeft <= 3 ? 'due-soon' : '';
      const dueLabel = a.completed ? 'Completed' : daysLeft === null ? 'No date set' : daysLeft < 0 ? `${Math.abs(daysLeft)} day${daysLeft === -1 ? '' : 's'} overdue` : daysLeft === 0 ? 'Due today' : daysLeft <= 3 ? `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : `Due ${dueDate}`;
      return `<article class="assignment-item ${urgency}"><input type="checkbox" class="tc" aria-label="Mark ${esc(a.title)} complete" ${a.completed ? 'checked' : ''} onchange="toggleAssignment(${a.id})"><div class="assignment-copy"><strong>${esc(a.title)}</strong><span>${esc(a.subject || 'General')} · ${dueLabel}</span></div><button class="btn btn-o btn-sm" onclick="editAssignment(${a.id})">Edit</button><button class="db always" aria-label="Delete assignment" onclick="delAssignment(${a.id})">✕</button></article>`;
    }).join('');
  }
  const upcoming = D.assignments.filter(a => !a.completed && a.dueDate && a.dueDate >= today()).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  const legacy = D.events.filter(e => e.type === 'assignment' && e.date >= today()).map(e => ({ title: e.title, subject: 'Assignment', dueDate: e.date, id: e.id, legacy: true }));
  const deadlines = [...upcoming, ...legacy].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  $('dashboardDeadlines').innerHTML = deadlines.length
    ? deadlines.map(a => `<div class="ei"><div class="etn">${esc(a.title)}</div><div class="em">${esc(a.subject || 'Assignment')} · ${esc(a.dueDate)}</div></div>`).join('')
    : '<div class="empty"><span class="ei2">🎉</span><span class="et2">No upcoming deadlines</span></div>';
}

function renderPlanner() {
  const items = [...D.planner].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const todayItems = items.filter(s => s.date === today());
  const renderItem = s => `<div class="planner-item"><div><strong>${esc(s.subject)}</strong><span>${esc(s.date)} · ${esc(s.time)} · ${Number(s.duration)} min</span></div><button class="db always" aria-label="Delete study session" onclick="delPlannerSession(${s.id})">✕</button></div>`;
  $('plannerSessions').innerHTML = items.length ? items.map(renderItem).join('') : '<div class="empty"><span class="ei2">📅</span><span class="et2">No study sessions planned</span></div>';
  $('dashboardSchedule').innerHTML = todayItems.length ? todayItems.map(renderItem).join('') : '<div class="empty"><span class="ei2">📖</span><span class="et2">No sessions planned for today</span></div>';
}

function renderAnalytics() {
  if (!$('analyticsChart')) return;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const thisWeek = D.sSessions.filter(s => {
    const date = new Date(s.date);
    date.setHours(0, 0, 0, 0);
    return date >= start;
  });
  const minutes = thisWeek.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  $('weeklyStudyHours').textContent = `${(minutes / 60).toFixed(1)}h`;
  $('weeklyTasksDone').textContent = D.todos.filter(t => t.completed && t.completedAt && t.completedAt >= start.getTime()).length;
  $('assignmentsCompleted').textContent = D.assignments.filter(a => a.completed).length;
  const canvas = $('analyticsChart');
  const width = canvas.parentElement.clientWidth || 420;
  const height = canvas.parentElement.clientHeight || 200;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const values = dayLabels.map((_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return thisWeek.filter(s => dateKeyFromTimestamp(s.date) === dateKeyFromDate(date)).reduce((sum, s) => sum + (Number(s.duration) || 0), 0) / 60;
  });
  const max = Math.max(1, ...values);
  const gap = 12;
  const slot = (width - 36) / 7;
  values.forEach((value, i) => {
    const barHeight = (value / max) * (height - 42);
    const x = 18 + i * slot + gap / 2;
    const y = height - 26 - barHeight;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f46e5';
    ctx.beginPath();
    ctx.roundRect(x, y, slot - gap, Math.max(2, barHeight), 5);
    ctx.fill();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text2').trim() || '#64748b';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dayLabels[i], x + (slot - gap) / 2, height - 8);
  });
}

function calcStreak() {
  if (!D.sSessions.length) return 0;
  const days = new Set(
    D.sSessions.map(s => {
      const d = new Date(s.date);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })
  );
  const c = new Date();
  c.setHours(0, 0, 0, 0);
  if (!days.has(c.getTime())) c.setDate(c.getDate() - 1);
  let n = 0;
  while (days.has(c.getTime())) {
    n++;
    c.setDate(c.getDate() - 1);
  }
  return n;
}

function renderActivity() {
  const items = [];
  D.sSessions.slice(-3).forEach(s =>
    items.push({
      txt: `Studied ${s.subject} for ${s.duration} min`,
      t: s.date,
      ico: '📚',
      bg: 'rgba(200,16,46,0.14)'
    })
  );
  D.todos
    .filter(t => t.completed)
    .slice(-2)
    .forEach(t => items.push({ txt: `Completed: ${t.text}`, t: t.completedAt || Date.now(), ico: '✅', bg: 'rgba(45,122,63,0.14)' }));
  items.sort((a, b) => b.t - a.t);
  const el = $('activityList');
  if (!items.length) {
    el.innerHTML = `<div class="empty"><span class="ei2">🕐</span><span class="et2">No recent activity</span></div>`;
    return;
  }
  el.innerHTML = items
    .slice(0, 5)
    .map(
      a =>
        `<div class="ai"><div class="ad" style="background:${a.bg}">${a.ico}</div><div class="at2">${esc(
          a.txt
        )}</div><span class="ag">${ago(a.t)}</span></div>`
    )
    .join('');
}

function renderFocus() {
  const t = today();
  const items = D.focus.filter(i => i.dateKey === t).sort((a, b) => Number(a.completed) - Number(b.completed));
  const el = $('focusList');
  if (!items.length) {
    el.innerHTML = `<div class="empty"><span class="ei2">🎯</span><span class="et2">No focus items</span></div>`;
    return;
  }
  el.innerHTML = items
    .map(
      i =>
        `<div class="fi ${i.completed ? 'done' : ''}"><input type="checkbox" class="tc" ${
          i.completed ? 'checked' : ''
        } onchange="toggleFocus(${i.id})"><span class="ft">${esc(i.text)}</span>${
          i.time ? `<span class="ftg">${esc(i.time)}</span>` : ''
        }<button class="db" onclick="delFocus(${i.id})">✕</button></div>`
    )
    .join('');
}

function resetFocusModal() {
  if ($('focusText')) $('focusText').value = '';
  if ($('focusTime')) $('focusTime').value = '';
}

window.toggleFocus = id => {
  const i = D.focus.find(f => f.id === id);
  if (i) {
    i.completed = !i.completed;
    save('focusItems', D.focus);
    renderFocus();
  }
};
window.delFocus = id => {
  D.focus = D.focus.filter(f => f.id !== id);
  save('focusItems', D.focus);
  renderFocus();
};
$('addFocusBtn').onclick = () => {
  resetFocusModal();
  openM('focusModalWrap');
  setTimeout(() => $('focusText')?.focus(), 0);
};
$('saveFocusBtn').onclick = () => {
  const text = $('focusText').value.trim();
  const time = $('focusTime').value.trim();
  if (!text) {
    toast('Enter a focus item', 'er');
    return;
  }
  D.focus.push({
    id: Date.now(),
    text,
    time,
    completed: false,
    dateKey: today(),
    createdAt: Date.now()
  });
  save('focusItems', D.focus);
  closeM('focusModalWrap');
  renderFocus();
  toast('Focus item added');
};

/* Chart */
$('weekFilter').onchange = renderChart;
window.addEventListener('resize', () => {
  renderChart();
  renderAnalytics();
});

function renderChart() {
  const canvas = $('weeklyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const par = canvas.parentElement;
  const W = par.clientWidth || 400;
  const H = par.clientHeight || 200;
  const dpr = devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const offset = $('weekFilter').value === 'last' ? 7 : 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dow = (now.getDay() + 6) % 7;
  const sow = new Date(now);
  sow.setDate(now.getDate() - dow - offset);

  const LABS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const vals = LABS.map((_, i) => {
    const d = new Date(sow);
    d.setDate(sow.getDate() + i);
    const key = dateKeyFromDate(d);
    return (
      D.sSessions
        .filter(s => dateKeyFromTimestamp(s.date) === key)
        .reduce((a, s) => a + (Number(s.duration) || 0), 0) / 60
    );
  });

  const maxV = Math.max(1, ...vals);
  const pad = { l: 36, r: 16, t: 14, b: 34 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  const bW = Math.min(36, cW / 7 - 6);
  const gap = (cW - bW * 7) / 6;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gc = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  const lc = isDark ? 'rgba(245,230,211,0.32)' : 'rgba(30,8,8,0.42)';

  ctx.font = `11px 'Cinzel',serif`;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (cH / 4) * i;
    const v = (1 - i / 4) * maxV;
    ctx.strokeStyle = gc;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = lc;
    ctx.textAlign = 'right';
    ctx.fillText(`${v >= 1 ? v.toFixed(0) : v.toFixed(1)}h`, pad.l - 4, y);
  }

  const gr = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  if (isDark) {
    gr.addColorStop(0, '#818cf8');
    gr.addColorStop(0.45, '#4f46e5');
    gr.addColorStop(1, '#2563eb');
  } else {
    gr.addColorStop(0, '#818cf8');
    gr.addColorStop(0.45, '#4f46e5');
    gr.addColorStop(1, '#2563eb');
  }

  ctx.textAlign = 'center';
  vals.forEach((v, i) => {
    const x = pad.l + i * (bW + gap);
    const bH = (v / maxV) * cH;
    const y = H - pad.b - bH;
    const r = 5;
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bW - r, y);
    ctx.quadraticCurveTo(x + bW, y, x + bW, y + r);
    ctx.lineTo(x + bW, H - pad.b);
    ctx.lineTo(x, H - pad.b);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();

    ctx.shadowColor = 'rgba(124,58,237,0.4)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = lc;
    ctx.fillText(LABS[i], x + bW / 2, H - pad.b + 14);
  });
}

/* Study tracker */
let curSubId = null;
$('addSubjectBtn').onclick = () => openM('subjectModalWrap');

$('saveSubjectBtn').onclick = () => {
  const name = $('subjectName').value.trim();
  const color = safeColor($('subjectColor').value);
  const target = clamp(parseInt($('subjectTarget').value, 10) || 10, 1, 168);
  if (!name) {
    toast('Enter a subject name.', 'er');
    return;
  }
  D.subjects.push({ id: Date.now(), name, color, target, totalHours: 0, sessions: 0 });
  save('subjects', D.subjects);
  renderSubjects();
  closeM('subjectModalWrap');
  $('subjectName').value = '';
  toast('Subject added');
};

function renderSubjects() {
  const g = $('subjectsGrid');
  if (!D.subjects.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="ei2">📖</span><span class="et2">No subjects yet</span></div>`;
    updateStudyStats();
    return;
  }
  g.innerHTML = D.subjects
    .map(s => {
      const h = Number(s.totalHours) || 0;
      const t = clamp(Number(s.target) || 10, 1, 168);
      const pct = Math.min((h / t) * 100, 100).toFixed(0);
      const sess = Math.max(0, Number(s.sessions) || 0);
      const avg = sess > 0 ? ((h / sess) * 60).toFixed(0) : 0;
      const col = safeColor(s.color);
      return `<div class="subc" style="border-left-color:${col}">
      <div class="subh"><div class="subn">${esc(s.name)}</div><button class="db always" onclick="delSubject(${s.id})">✕</button></div>
      <div class="pl"><span>${h.toFixed(1)}h / ${t}h</span><span>${pct}%</span></div>
      <div class="pb"><div class="pf" style="width:${pct}%;background:linear-gradient(90deg,${col},${col}aa)"></div></div>
      <div class="sm"><span>${sess} sessions</span><span>${avg} min avg</span></div>
      <div class="sf2"><button class="btn btn-o btn-sm" onclick="logSess(${s.id})">＋ Log session</button></div>
    </div>`;
    })
    .join('');
  updateStudyStats();
}

function updateStudyStats() {
  const ts = D.subjects.reduce((a, s) => a + (Number(s.sessions) || 0), 0);
  const th = D.subjects.reduce((a, s) => a + (Number(s.totalHours) || 0), 0);
  $('totalSessions').textContent = ts;
  $('avgDuration').textContent = ts > 0 ? `${((th / ts) * 60).toFixed(0)} min` : '0 min';
  const top = D.subjects.reduce((a, s) => ((Number(s.totalHours) || 0) > (Number(a?.totalHours) || 0) ? s : a), null);
  $('topSubject').textContent = top?.name || '—';
}

window.delSubject = id => {
  showConfirm({
    title: 'Delete subject',
    message: 'This will remove the subject from your tracker.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      D.subjects = D.subjects.filter(s => s.id !== id);
      save('subjects', D.subjects);
      renderSubjects();
    }
  });
};

window.logSess = id => {
  curSubId = id;
  $('sessionDuration').value = '';
  $('sessionNotes').value = '';
  openM('sessionModalWrap');
};

$('saveSessionBtn').onclick = () => {
  const dur = parseInt($('sessionDuration').value, 10) || 0;
  if (dur <= 0) {
    toast('Enter a valid duration.', 'er');
    return;
  }
  const sub = D.subjects.find(s => s.id === curSubId);
  if (!sub) return;
  sub.totalHours = (Number(sub.totalHours) || 0) + dur / 60;
  sub.sessions = (Number(sub.sessions) || 0) + 1;
  D.sSessions.push({ subject: sub.name, duration: dur, notes: $('sessionNotes').value.trim(), date: Date.now() });
  save('subjects', D.subjects);
  save('studySessions', D.sSessions);
  renderSubjects();
  closeM('sessionModalWrap');
  updateDashboard();
  renderChart();
  toast('Session logged! 🎉');
};

/* Study planner */
$('plannerDate').value = today();
$('addPlannerSessionBtn').onclick = () => {
  const subject = $('plannerSubject').value.trim();
  const date = $('plannerDate').value;
  const time = $('plannerTime').value;
  const duration = clamp(parseInt($('plannerDuration').value, 10) || 0, 15, 480);
  if (!subject || !date || !time) {
    toast('Add a subject, date, and start time.', 'er');
    return;
  }
  D.planner.push({ id: Date.now(), subject, date, time, duration, createdAt: Date.now() });
  save('plannerSessions', D.planner);
  $('plannerSubject').value = '';
  $('plannerTime').value = '';
  renderPlanner();
  toast('Study session scheduled');
};
window.delPlannerSession = id => {
  D.planner = D.planner.filter(s => s.id !== id);
  save('plannerSessions', D.planner);
  renderPlanner();
};

/* Assignment tracker */
$('assignmentDueDate').value = today();
$('addAssignmentBtn').onclick = () => {
  const title = $('assignmentTitle').value.trim();
  const subject = $('assignmentSubject').value.trim();
  const dueDate = $('assignmentDueDate').value;
  if (!title || !subject || !dueDate) {
    toast('Add a title, subject, and submission date.', 'er');
    return;
  }
  D.assignments.push({ id: Date.now(), title, subject, dueDate, completed: false, createdAt: Date.now() });
  save('assignments', D.assignments);
  $('assignmentTitle').value = '';
  $('assignmentSubject').value = '';
  $('assignmentDueDate').value = today();
  renderAssignments();
  updateDashboard();
  toast('Assignment added');
};
window.toggleAssignment = id => {
  const assignment = D.assignments.find(a => a.id === id);
  if (!assignment) return;
  assignment.completed = !assignment.completed;
  assignment.completedAt = assignment.completed ? Date.now() : null;
  save('assignments', D.assignments);
  renderAssignments();
  updateDashboard();
};
let editAssignmentId = null;
window.editAssignment = id => {
  const assignment = D.assignments.find(a => a.id === id);
  if (!assignment) return;
  editAssignmentId = id;
  $('editAssignmentTitle').value = assignment.title;
  $('editAssignmentSubject').value = assignment.subject;
  $('editAssignmentDate').value = assignment.dueDate;
  openM('assignmentEditModalWrap');
};
$('saveAssignmentEditBtn').onclick = () => {
  const assignment = D.assignments.find(a => a.id === editAssignmentId);
  const title = $('editAssignmentTitle').value.trim();
  const subject = $('editAssignmentSubject').value.trim();
  const dueDate = $('editAssignmentDate').value;
  if (!assignment || !title || !subject || !dueDate) {
    toast('Fill in the assignment details.', 'er');
    return;
  }
  Object.assign(assignment, { title, subject, dueDate });
  save('assignments', D.assignments);
  renderAssignments();
  updateDashboard();
  closeM('assignmentEditModalWrap');
};
window.delAssignment = id => {
  D.assignments = D.assignments.filter(a => a.id !== id);
  save('assignments', D.assignments);
  renderAssignments();
  updateDashboard();
};

/* Todo */
let tFilter = 'all';
function renderTodos() {
  let items = D.todos;
  if (tFilter === 'active') items = D.todos.filter(t => !t.completed);
  if (tFilter === 'completed') items = D.todos.filter(t => t.completed);
  const el = $('todoList');
  if (!items.length) {
    el.innerHTML = `<div class="empty"><span class="ei2">✅</span><span class="et2">No tasks</span></div>`;
    return;
  }
  el.innerHTML = items
    .map(
      t =>
        `<div class="ti ${t.completed ? 'done' : ''}"><input type="checkbox" class="tc" ${
          t.completed ? 'checked' : ''
        } onchange="toggleTodo(${t.id})"><div class="pp ${t.priority || 'medium'}"></div><span class="tt">${esc(
          t.text
        )}</span>${t.dueDate ? `<span class="task-due">${esc(t.dueDate)}</span>` : ''}<button class="db always" aria-label="Edit task" onclick="editTodo(${t.id})">✎</button><button class="db always" aria-label="Delete task" onclick="delTodo(${t.id})">✕</button></div>`
    )
    .join('');
}

function addTodo() {
  const inp = $('todoInput');
  const txt = inp.value.trim();
  if (!txt) return;
  D.todos.push({ id: Date.now(), text: txt, priority: $('todoPriority').value, dueDate: $('todoDueDate').value, completed: false, createdAt: Date.now() });
  save('todos', D.todos);
  renderTodos();
  inp.value = '';
  $('todoDueDate').value = '';
  updateDashboard();
  toast('Task added');
}
$('addTodoBtn').onclick = addTodo;
$('todoInput').onkeydown = e => {
  if (e.key === 'Enter') addTodo();
};
window.toggleTodo = id => {
  const t = D.todos.find(x => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  if (t.completed) t.completedAt = Date.now();
  save('todos', D.todos);
  renderTodos();
  updateDashboard();
};
window.delTodo = id => {
  D.todos = D.todos.filter(t => t.id !== id);
  save('todos', D.todos);
  renderTodos();
  updateDashboard();
};
let editTodoId = null;
window.editTodo = id => {
  const task = D.todos.find(t => t.id === id);
  if (!task) return;
  editTodoId = id;
  $('editTaskText').value = task.text;
  $('editTaskPriority').value = task.priority || 'medium';
  $('editTaskDueDate').value = task.dueDate || '';
  openM('taskEditModalWrap');
};
$('saveTaskEditBtn').onclick = () => {
  const task = D.todos.find(t => t.id === editTodoId);
  const text = $('editTaskText').value.trim();
  if (!task || !text) {
    toast('Task description cannot be empty.', 'er');
    return;
  }
  task.text = text;
  task.priority = $('editTaskPriority').value;
  task.dueDate = $('editTaskDueDate').value;
  save('todos', D.todos);
  renderTodos();
  updateDashboard();
  closeM('taskEditModalWrap');
};
document.querySelectorAll('.fb').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.fb').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    tFilter = b.dataset.filter;
    renderTodos();
  };
});

/* Pomodoro */
const CIRC = 2 * Math.PI * 96;
let timeLeft = D.settings.pomodoro * 60;
let pomRun = false;
let pomInt = null;
let pomMode = 'pomodoro';
let pomCount = 0;

function getModeTime() {
  return pomMode === 'pomodoro' ? D.settings.pomodoro : pomMode === 'short' ? D.settings.shortBreak : D.settings.longBreak;
}

function updateTimer() {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  $('timerDisplay').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const total = getModeTime() * 60;
  const off = CIRC - (CIRC * (total - timeLeft)) / total;
  $('ringProgress').style.strokeDashoffset = clamp(off, 0, CIRC);
}

function resetTimer() {
  clearInterval(pomInt);
  pomRun = false;
  timeLeft = getModeTime() * 60;
  updateTimer();
  const b = $('timerStartBtn');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start`;
  b.className = 'btn btn-p';
  $('timerLabel').textContent = pomMode === 'pomodoro' ? 'FOCUS TIME' : pomMode === 'short' ? 'SHORT BREAK' : 'LONG BREAK';
}

function startTimer() {
  if (pomRun) {
    pauseTimer();
    return;
  }
  if (timeLeft <= 0) resetTimer();
  pomRun = true;
  const b = $('timerStartBtn');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Pause`;
  b.className = 'btn btn-o';
  pomInt = setInterval(() => {
    timeLeft--;
    updateTimer();
    if (timeLeft <= 0) completeTimer();
  }, 1000);
}

function pauseTimer() {
  clearInterval(pomInt);
  pomRun = false;
  const b = $('timerStartBtn');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Resume`;
  b.className = 'btn btn-p';
}

function completeTimer() {
  clearInterval(pomInt);
  pomRun = false;
  if (D.settings.soundEnabled) {
    try {
      new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==').play();
    } catch {
      /* no-op */
    }
  }
  if (pomMode === 'pomodoro') {
    pomCount = (pomCount + 1) % 4;
    D.pSessions.push({ type: 'pomodoro', duration: D.settings.pomodoro, date: Date.now() });
    save('pomodoroSessions', D.pSessions);
    D.sSessions.push({ subject: 'Focus Timer', duration: D.settings.pomodoro, notes: 'Completed focus timer session', date: Date.now() });
    save('studySessions', D.sSessions);
    updatePomStats();
    updateDashboard();
    renderChart();
    toast('Pomodoro done! Take a break 🎉');
    if (D.settings.autoStartBreaks) {
      setTimeout(() => {
        switchMode(pomCount === 0 ? 'long' : 'short');
        startTimer();
      }, 2000);
    }
  } else {
    D.pSessions.push({ type: pomMode, duration: getModeTime(), date: Date.now() });
    save('pomodoroSessions', D.pSessions);
    updatePomStats();
    toast("Break over! Let's focus 💪");
    if (D.settings.autoStartBreaks) {
      setTimeout(() => {
        switchMode('pomodoro');
        startTimer();
      }, 2000);
    }
  }
  const b = $('timerStartBtn');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start`;
  b.className = 'btn btn-p';
}

function switchMode(m) {
  pomMode = m;
  document.querySelectorAll('.mt2').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
  resetTimer();
}

function updatePomStats() {
  const focus = D.pSessions.filter(s => s.type === 'pomodoro');
  const total = focus.reduce((a, s) => a + (Number(s.duration) || 0), 0);
  $('pomodoroCount').textContent = `${focus.length % 4}/4`;
  $('pomodoroTotalTime').textContent = `${Math.floor(total / 60)}h ${total % 60}m`;
  const hist = $('timerHistory');
  const rec = [...D.pSessions].reverse().slice(0, 8);
  if (!rec.length) {
    hist.innerHTML = `<div class="empty"><span class="ei2">⏱</span><span class="et2">No sessions yet</span></div>`;
    return;
  }
  hist.innerHTML = rec
    .map(s => {
      const cls = s.type === 'pomodoro' ? 'hbf' : s.type === 'short' ? 'hbs' : 'hbl';
      const lbl = s.type === 'pomodoro' ? 'Focus' : s.type === 'short' ? 'Short break' : 'Long break';
      return `<div class="hi"><span class="hb ${cls}">${lbl}</span><div class="hd"><div class="hn">${new Date(
        s.date
      ).toLocaleDateString()}</div><div class="hda">${new Date(s.date).toLocaleTimeString()}</div></div><span class="hdr">${s.duration}m</span></div>`;
    })
    .join('');
}

document.querySelectorAll('.mt2').forEach(b => {
  b.onclick = () => {
    if (!pomRun) switchMode(b.dataset.mode);
  };
});
$('timerStartBtn').onclick = startTimer;
$('timerResetBtn').onclick = resetTimer;

$('pomSettingsBtn').onclick = () => {
  $('pomodoroDuration').value = D.settings.pomodoro;
  $('shortBreakDuration').value = D.settings.shortBreak;
  $('longBreakDuration').value = D.settings.longBreak;
  $('autoStartBreaks').checked = D.settings.autoStartBreaks;
  $('soundEnabled').checked = D.settings.soundEnabled;
  openM('pomSettingsModalWrap');
};
$('savePomSettingsBtn').onclick = () => {
  D.settings.pomodoro = clamp(parseInt($('pomodoroDuration').value, 10) || 25, 1, 60);
  D.settings.shortBreak = clamp(parseInt($('shortBreakDuration').value, 10) || 5, 1, 30);
  D.settings.longBreak = clamp(parseInt($('longBreakDuration').value, 10) || 15, 1, 60);
  D.settings.autoStartBreaks = $('autoStartBreaks').checked;
  D.settings.soundEnabled = $('soundEnabled').checked;
  save('pomodoroSettings', D.settings);
  closeM('pomSettingsModalWrap');
  resetTimer();
  toast('Settings saved');
};
$('goalProgress').oninput = e => {
  $('goalProgressValue').textContent = `${e.target.value}%`;
};
/* Notes */
let editNoteId = null;
$('addNoteBtn').onclick = () => {
  editNoteId = null;
  $('noteModalTitle').textContent = 'New Note';
  $('noteTitle').value = '';
  $('noteSubject').value = '';
  $('noteContent').value = '';
  openM('noteModalWrap');
};
$('saveNoteBtn').onclick = () => {
  const title = $('noteTitle').value.trim();
  const subject = $('noteSubject').value.trim();
  const content = $('noteContent').value.trim();
  if (!title || !content) {
    toast('Fill in both title and content.', 'er');
    return;
  }
  if (editNoteId !== null) {
    const n = D.notes.find(x => x.id === editNoteId);
    if (n) {
      n.title = title;
      n.subject = subject;
      n.content = content;
      n.updatedAt = Date.now();
    }
  } else {
    D.notes.push({ id: Date.now(), title, subject, content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  save('notes', D.notes);
  renderNotes();
  closeM('noteModalWrap');
  toast('Note saved');
};

function renderNotes() {
  const g = $('notesGrid');
  const search = $('notesSearch').value.trim().toLowerCase();
  const subject = $('notesSubjectFilter').value;
  const subjects = [...new Set(D.notes.map(n => String(n.subject || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const select = $('notesSubjectFilter');
  const selectedSubject = select.value;
  select.innerHTML = '<option value="">All subjects</option>' + subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if (subjects.includes(selectedSubject)) select.value = selectedSubject;
  const filtered = D.notes.filter(n =>
    (!subject || n.subject === subject) &&
    (!search || `${n.title} ${n.content} ${n.subject || ''}`.toLowerCase().includes(search))
  );
  if (!filtered.length) {
    g.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="ei2">📝</span><span class="et2">No notes yet</span></div>`;
    return;
  }
  g.innerHTML = filtered
    .map(n => {
      const prev = n.content.length > 160 ? `${n.content.slice(0, 160)}…` : n.content;
      return `<div class="nc" onclick="editNote(${n.id})"><div class="nh"><div class="nt">${esc(
        n.title
      )}</div><button class="db always" onclick="event.stopPropagation();delNote(${n.id})">✕</button></div>${n.subject ? `<div class="note-subject">${esc(n.subject)}</div>` : ''}<div class="nb">${esc(
        prev
      )}</div><div class="nf"><span>${new Date(n.updatedAt).toLocaleDateString()}</span><span>${n.content.length} chars</span></div></div>`;
    })
    .join('');
}
window.editNote = id => {
  const n = D.notes.find(x => x.id === id);
  if (!n) return;
  editNoteId = id;
  $('noteModalTitle').textContent = 'Edit Note';
  $('noteTitle').value = n.title;
  $('noteSubject').value = n.subject || '';
  $('noteContent').value = n.content;
  openM('noteModalWrap');
};
$('notesSearch').addEventListener('input', renderNotes);
$('notesSubjectFilter').addEventListener('change', renderNotes);
window.delNote = id => {
  showConfirm({
    title: 'Delete note',
    message: 'This note will be deleted permanently.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      D.notes = D.notes.filter(n => n.id !== id);
      save('notes', D.notes);
      renderNotes();
    }
  });
};

/* Calendar */
let calDate = new Date();
$('addEventBtn').onclick = () => {
  $('eventDate').value = today();
  openM('eventModalWrap');
};
$('saveEventBtn').onclick = () => {
  const title = $('eventTitle').value.trim();
  const date = $('eventDate').value;
  if (!title || !date) {
    toast('Fill in title and date.', 'er');
    return;
  }
  D.events.push({ id: Date.now(), title, date, time: $('eventTime').value, type: $('eventType').value, createdAt: Date.now() });
  save('events', D.events);
  renderCalendar();
  updateDashboard();
  closeM('eventModalWrap');
  $('eventTitle').value = '';
  toast('Event added');
};
$('prevMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth() - 1);
  renderCalendar();
};
$('nextMonth').onclick = () => {
  calDate.setMonth(calDate.getMonth() + 1);
  renderCalendar();
};

function renderCalendar() {
  const y = calDate.getFullYear();
  const m = calDate.getMonth();
  $('currentMonth').textContent = calDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const firstDay = new Date(y, m, 1).getDay();
  const dims = new Date(y, m + 1, 0).getDate();
  const prev = new Date(y, m, 0).getDate();
  const evDates = new Set(D.events.map(e => e.date));
  const g = $('calendarGrid');
  g.innerHTML = '';
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'cdh';
    h.textContent = d;
    g.appendChild(h);
  });
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = document.createElement('div');
    d.className = 'cd other';
    d.textContent = prev - i;
    g.appendChild(d);
  }
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = 1; i <= dims; i++) {
    const d = document.createElement('div');
    d.className = 'cd';
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    if (evDates.has(ds)) d.classList.add('has-event');
    if (new Date(y, m, i).getTime() === now.getTime()) d.classList.add('today');
    d.textContent = i;
    g.appendChild(d);
  }
  const rem = 42 - (firstDay + dims);
  for (let i = 1; i <= rem; i++) {
    const d = document.createElement('div');
    d.className = 'cd other';
    d.textContent = i;
    g.appendChild(d);
  }
  renderUpcoming();
}

function renderUpcoming() {
  const t = today();
  const up = D.events.filter(e => e.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const el = $('upcomingEvents');
  if (!up.length) {
    el.innerHTML = `<div class="empty"><span class="ei2">📅</span><span class="et2">No upcoming events</span></div>`;
    return;
  }
  const TC = { exam: '#f43f5e', assignment: '#f59e0b', class: '#0ea5e9', other: '#7c3aed' };
  el.innerHTML = up
    .map(e => {
      const c = TC[e.type] || '#7c3aed';
      return `<div class="ei" style="border-left-color:${c}"><div class="etn">${esc(e.title)}</div><div class="em">${e.date}${
        e.time ? ` · ${e.time}` : ''
      }</div><span class="etb" style="background:${c}20;color:${c}">${e.type}</span></div>`;
    })
    .join('');
}
/* Goals */
let editingGoalId = null;

function resetGoalUpdateModal() {
  editingGoalId = null;
  if ($('goalUpdateTitle')) $('goalUpdateTitle').textContent = '';
  if ($('goalUpdateRange')) $('goalUpdateRange').value = 0;
  if ($('goalUpdateValue')) $('goalUpdateValue').textContent = '0%';
}

$('goalUpdateRange').oninput = e => {
  $('goalUpdateValue').textContent = `${e.target.value}%`;
};

$('saveGoalUpdateBtn').onclick = () => {
  if (editingGoalId === null) {
    closeM('goalUpdateModalWrap');
    return;
  }
  const g = D.goals.find(x => x.id === editingGoalId);
  if (!g) {
    closeM('goalUpdateModalWrap');
    return;
  }
  const prev = clamp(Number(g.progress) || 0, 0, 100);
  g.progress = clamp(parseInt($('goalUpdateRange').value, 10) || 0, 0, 100);
  save('goals', D.goals);
  renderGoals();
  closeM('goalUpdateModalWrap');
  if (prev < 100 && g.progress === 100) toast('Goal completed! 🎉');
  else toast('Goal updated');
};

$('addGoalBtn').onclick = () => {
  $('goalDate').value = today();
  $('goalProgress').value = 0;
  $('goalProgressValue').textContent = '0%';
  $('goalTitle').value = '';
  openM('goalModalWrap');
};
$('saveGoalBtn').onclick = () => {
  const title = $('goalTitle').value.trim();
  const date = $('goalDate').value;
  const progress = clamp(parseInt($('goalProgress').value, 10) || 0, 0, 100);
  if (!title || !date) {
    toast('Fill in title and date.', 'er');
    return;
  }
  D.goals.push({ id: Date.now(), title, date, progress, createdAt: Date.now() });
  save('goals', D.goals);
  renderGoals();
  closeM('goalModalWrap');
  toast('Goal created! 🚀');
};

function renderGoals() {
  const el = $('goalsList');
  if (!D.goals.length) {
    el.innerHTML = `<div class="empty"><span class="ei2">🏆</span><span class="et2">No goals yet</span></div>`;
    return;
  }
  el.innerHTML = D.goals
    .map(g => {
      const p = clamp(Number(g.progress) || 0, 0, 100);
      const col = p === 100 ? '#2d7a3f' : p >= 60 ? '#d4a017' : '#c8102e';
      return `<div class="gc"><div class="gch"><div><div class="gct">${esc(g.title)}</div><div class="gcd">Target: ${g.date}</div></div><div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;background:linear-gradient(135deg,${col},${col}aa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">${p}%</div></div><div class="gpl"><span>Progress</span><span>${
        p === 100 ? '🎉 Complete' : 'In progress'
      }</span></div><div class="pb" style="height:8px"><div class="pf" style="width:${p}%;background:linear-gradient(90deg,${col},${col}aa)"></div></div><div class="gf"><button class="btn btn-o btn-sm" onclick="updateGoal(${g.id})">Update</button><button class="btn btn-o btn-sm" style="color:#f43f5e" onclick="delGoal(${g.id})">Delete</button></div></div>`;
    })
    .join('');
}

window.updateGoal = id => {
  const g = D.goals.find(x => x.id === id);
  if (!g) return;
  editingGoalId = id;
  const p = clamp(Number(g.progress) || 0, 0, 100);
  $('goalUpdateTitle').textContent = `Progress for "${g.title}"`;
  $('goalUpdateRange').value = p;
  $('goalUpdateValue').textContent = `${p}%`;
  openM('goalUpdateModalWrap');
};

window.delGoal = id => {
  showConfirm({
    title: 'Delete goal',
    message: 'This goal will be deleted permanently.',
    confirmLabel: 'Delete',
    danger: true,
    onConfirm: () => {
      D.goals = D.goals.filter(g => g.id !== id);
      save('goals', D.goals);
      renderGoals();
    }
  });
};

/* Init */
(function init() {
  $('authLoader')?.remove();
  const name = SESSION.name || 'Student';
  $('userName').textContent = name;
  $('userAvatar').textContent = name[0].toUpperCase();
  if ($('greetName')) $('greetName').textContent = name.split(' ')[0];

  renderSubjects();
  renderTodos();
  renderNotes();
  renderCalendar();
  renderGoals();
  updatePomStats();
  updateTimer();
  updateDashboard();

  $('eventDate').value = today();
  $('goalDate').value = today();
  setTimeout(renderChart, 50);
})();
