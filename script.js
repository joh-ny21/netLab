/* ============================================================
   NETWORK SIMULATOR — SHARED LOGIC
   JSONP for cross-device config sync (CORS-free)
   Clean canvas handling to prevent tool glitches
   Reliable Google Sheets recording
   Full T568A and T568B support
   ============================================================ */

const ADMIN_PASSWORD = 'admin123';

// ============================================================
// ⚙️ HARDCODED BACKEND — PASTE YOUR APPS SCRIPT URL HERE
// ============================================================
const HARDCODED_WEBHOOK_URL = 'PASTE_YOUR_APPS_SCRIPT_URL_HERE';
const HARDCODED_TOKEN = '';

// ============================================================
// WIRING STANDARDS
// ============================================================
const WIRE_STANDARDS = {
  A: [
    { name: 'White-Green', hex: '#3CB371', stripe: true, base: '#3CB371', second: '#FFFFFF' },
    { name: 'Green', hex: '#3CB371', stripe: false },
    { name: 'White-Orange', hex: '#F5A623', stripe: true, base: '#F5A623', second: '#FFFFFF' },
    { name: 'Blue', hex: '#1E90FF', stripe: false },
    { name: 'White-Blue', hex: '#1E90FF', stripe: true, base: '#1E90FF', second: '#FFFFFF' },
    { name: 'Orange', hex: '#F5A623', stripe: false },
    { name: 'White-Brown', hex: '#8B4513', stripe: true, base: '#8B4513', second: '#FFFFFF' },
    { name: 'Brown', hex: '#8B4513', stripe: false }
  ],
  B: [
    { name: 'White-Orange', hex: '#F5A623', stripe: true, base: '#F5A623', second: '#FFFFFF' },
    { name: 'Orange', hex: '#F5A623', stripe: false },
    { name: 'White-Green', hex: '#3CB371', stripe: true, base: '#3CB371', second: '#FFFFFF' },
    { name: 'Blue', hex: '#1E90FF', stripe: false },
    { name: 'White-Blue', hex: '#1E90FF', stripe: true, base: '#1E90FF', second: '#FFFFFF' },
    { name: 'Green', hex: '#3CB371', stripe: false },
    { name: 'White-Brown', hex: '#8B4513', stripe: true, base: '#8B4513', second: '#FFFFFF' },
    { name: 'Brown', hex: '#8B4513', stripe: false }
  ]
};

// ==================== STORAGE HELPERS ====================
function getSheetConfig() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('sheet_config') || '{}');
  } catch (e) { stored = {}; }

  const url = (stored.url && stored.url.trim()) || HARDCODED_WEBHOOK_URL || '';
  const token = (stored.token && stored.token.trim()) || HARDCODED_TOKEN || '';
  const autoSync = stored.autoSync !== false;

  return { url, token, autoSync };
}

function saveSheetConfig(cfg) {
  localStorage.setItem('sheet_config', JSON.stringify(cfg));
}

function getExamConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('exam_config') || '{}');
    return {
      isOpen: !!saved.isOpen,
      timeLimitMinutes: saved.timeLimitMinutes || 15,
      passThreshold: saved.passThreshold || 70,
      maxViolations: saved.maxViolations || 3,
      shuffleTasks: saved.shuffleTasks !== false,
      tasks: Array.isArray(saved.tasks) ? saved.tasks : []
    };
  } catch (e) {
    return {
      isOpen: false, timeLimitMinutes: 15, passThreshold: 70,
      maxViolations: 3, shuffleTasks: true, tasks: []
    };
  }
}
function saveExamConfig(cfg) {
  localStorage.setItem('exam_config', JSON.stringify(cfg));
}

// ==================== JSONP (CORS-FREE GET) ====================
let _jsonpCounter = 0;

function jsonpRequest(baseUrl, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'nsJsonp_' + (++_jsonpCounter) + '_' + Date.now();
    const sep = baseUrl.includes('?') ? '&' : '?';
    const query = new URLSearchParams({ ...params, callback: callbackName }).toString();
    const finalUrl = baseUrl + sep + query;

    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      try { delete window[callbackName]; } catch (e) {}
      if (script.parentNode) script.parentNode.removeChild(script);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, timeoutMs);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP script load error'));
    };

    script.src = finalUrl;
    document.head.appendChild(script);
  });
}

// ==================== CLOUD SYNC ====================
async function publishConfigToCloud(config) {
  const sheetCfg = getSheetConfig();
  if (!sheetCfg.url) {
    return { success: false, error: 'No webhook URL configured' };
  }
  try {
    const payload = { action: 'save_config', config: config };
    if (sheetCfg.token) payload.token = sheetCfg.token;

    await fetch(sheetCfg.url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function fetchConfigFromCloud() {
  const sheetCfg = getSheetConfig();
  if (!sheetCfg.url) {
    return { success: false, error: 'No webhook URL configured' };
  }
  try {
    const data = await jsonpRequest(sheetCfg.url, { action: 'get_config' });
    if (!data.success) return { success: false, error: data.error || 'Unknown error' };
    return { success: true, config: data.config, updatedAt: data.updatedAt };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function syncConfigFromCloud() {
  const result = await fetchConfigFromCloud();
  if (!result.success || !result.config) return result;

  const localCfg = getExamConfig();
  const cloudCfg = result.config;

  const merged = {
    isOpen: !!cloudCfg.isOpen,
    timeLimitMinutes: cloudCfg.timeLimitMinutes || localCfg.timeLimitMinutes,
    passThreshold: cloudCfg.passThreshold || localCfg.passThreshold,
    maxViolations: cloudCfg.maxViolations || localCfg.maxViolations,
    shuffleTasks: cloudCfg.shuffleTasks !== false,
    tasks: Array.isArray(cloudCfg.tasks) ? cloudCfg.tasks : []
  };

  localStorage.setItem('exam_config', JSON.stringify(merged));
  console.log('✅ Config synced from cloud:', merged);
  return { success: true, config: merged };
}

// ==================== SAVE RESULT ====================
async function submitToGoogleSheet(record) {
  const cfg = getSheetConfig();
  if (!cfg.url) {
    return { success: false, error: 'No webhook URL configured' };
  }

  let details = record.details || {};
  let detailsStr = JSON.stringify(details);
  if (detailsStr.length > 1500) {
    details = {
      tasks: (details.tasks || []).map(t => ({
        title: String(t.title || '').substring(0, 50),
        type: t.type,
        earned: t.earned,
        points: t.points,
        passed: t.passed
      })),
      autoSubmit: details.autoSubmit,
      reason: details.reason,
      trimmed: true
    };
  }

  const payload = {
    studentName: String(record.studentName || 'Unknown').substring(0, 100),
    studentId: String(record.studentId || '—').substring(0, 50),
    score: record.score || 0,
    passed: !!record.passed,
    grade: record.grade || 'F',
    violations: record.violations || 0,
    challenges: record.challenges || 0,
    timestamp: record.timestamp || new Date().toISOString(),
    details: details
  };

  try {
    const params = {
      action: 'save_result',
      payload: JSON.stringify(payload)
    };
    if (cfg.token) params.token = cfg.token;

    const data = await jsonpRequest(cfg.url, params, 15000);

    if (data && data.success) {
      console.log('✅ Result saved to Google Sheets, row:', data.row);
      return { success: true, row: data.row };
    }
    console.warn('⚠️ JSONP save rejected:', data && data.error);
  } catch (err) {
    console.warn('⚠️ JSONP save failed:', err.message);
  }

  try {
    const fallbackPayload = { ...payload, action: 'save_result' };
    if (cfg.token) fallbackPayload.token = cfg.token;

    await fetch(cfg.url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(fallbackPayload)
    });
    console.log('✅ Result sent via POST fallback (unverified)');
    return { success: true, fallback: true };
  } catch (err2) {
    return { success: false, error: err2.toString() };
  }
}

async function fetchResultsFromCloud() {
  const sheetCfg = getSheetConfig();
  if (!sheetCfg.url) {
    return { success: false, error: 'No webhook URL configured' };
  }
  try {
    const data = await jsonpRequest(sheetCfg.url, { action: 'list_results' });
    if (!data.success) return { success: false, error: data.error || 'Unknown' };
    return { success: true, results: data.results || [] };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/* ============================================================
   LOGIN PAGE
   ============================================================ */
(function () {
  const loginScreen = document.querySelector('.login-screen');
  if (!loginScreen) return;

  localStorage.removeItem('current_user');

  const roleStudent = document.getElementById('roleStudent');
  const roleAdmin = document.getElementById('roleAdmin');
  const loginName = document.getElementById('loginName');
  const loginId = document.getElementById('loginId');
  const loginPassword = document.getElementById('loginPassword');
  const loginPasswordGroup = document.getElementById('loginPasswordGroup');
  const loginIdGroup = document.getElementById('loginIdGroup');
  const loginNameLabel = document.getElementById('loginNameLabel');
  const loginIdLabel = document.getElementById('loginIdLabel');
  const loginError = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const loginHint = document.getElementById('loginHint');

  let selectedRole = 'student';

  function setRole(role) {
    selectedRole = role;
    roleStudent.classList.toggle('active', role === 'student');
    roleAdmin.classList.toggle('active', role === 'admin');
    loginError.textContent = '';
    if (role === 'student') {
      loginNameLabel.textContent = 'Full Name';
      loginIdLabel.textContent = 'Student ID';
      loginName.placeholder = 'Enter your full name';
      loginId.placeholder = 'Enter your ID number';
      loginIdGroup.style.display = 'block';
      loginPasswordGroup.style.display = 'none';
      loginHint.textContent = 'Demo: Any name + ID works for student login.';
    } else {
      loginNameLabel.textContent = 'Admin Username';
      loginName.placeholder = 'Enter admin username';
      loginIdGroup.style.display = 'none';
      loginPasswordGroup.style.display = 'block';
      loginHint.textContent = 'Default admin password: admin123';
    }
  }

  setRole('student');

  roleStudent.addEventListener('click', (e) => { e.preventDefault(); setRole('student'); });
  roleAdmin.addEventListener('click', (e) => { e.preventDefault(); setRole('admin'); });
  loginBtn.addEventListener('click', handleLogin);
  loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogin(); });
  loginName.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogin(); });
  loginId.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleLogin(); });

  function handleLogin() {
    const name = loginName.value.trim();
    loginError.textContent = '';
    if (!name) { loginError.textContent = '⚠️ Please enter your name.'; return; }
    localStorage.removeItem('current_user');

    if (selectedRole === 'student') {
      const id = loginId.value.trim();
      if (!id) { loginError.textContent = '⚠️ Please enter your Student ID.'; return; }
      localStorage.setItem('current_user', JSON.stringify({ name, id, role: 'student' }));
      window.location.href = 'student.html';
    } else {
      const pwd = loginPassword.value;
      if (pwd !== ADMIN_PASSWORD) { loginError.textContent = '❌ Incorrect admin password.'; return; }
      localStorage.setItem('current_user', JSON.stringify({ name, id: 'ADMIN', role: 'admin' }));
      window.location.href = 'admin.html';
    }
  }
})();

/* ============================================================
   LOGOUT
   ============================================================ */
document.addEventListener('click', (e) => {
  if (e.target.id === 'logoutBtn') {
    if (window.examActive && window.examActive()) {
      alert('⚠️ Cannot logout during an active exam.');
      return;
    }
    localStorage.removeItem('current_user');
    window.location.href = 'index.html';
  }
});

/* ============================================================
   ADMIN PAGE
   ============================================================ */
window.initAdminPage = function () {
  const $ = (id) => document.getElementById(id);
  let pendingTasks = JSON.parse(JSON.stringify(getExamConfig().tasks || []));

  document.querySelectorAll('.admin-menu-item').forEach((item) => {
    item.addEventListener('click', () => switchPanel(item.dataset.panel));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchPanel(item.dataset.panel); }
    });
  });

  function switchPanel(panel) {
    document.querySelectorAll('.admin-menu-item').forEach((i) => i.classList.remove('active'));
    const menuEl = document.querySelector(`.admin-menu-item[data-panel="${panel}"]`);
    if (menuEl) menuEl.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach((p) => p.classList.remove('active'));
    const target = $('panel' + panel.charAt(0).toUpperCase() + panel.slice(1));
    if (target) target.classList.add('active');

    if (panel === 'examControl') refreshExamStatusUI();
    if (panel === 'taskBuilder') renderTaskList();
    if (panel === 'retakeToken') refreshTokenUI();
    if (panel === 'studentResults') refreshResultsTable();
  }

  function refreshExamStatusUI() {
    const cfg = getExamConfig();
    const card = $('adminExamStatusCard');
    if (cfg.isOpen) {
      card.classList.add('open');
      $('aescIcon').textContent = '🔓';
      $('aescStatus').textContent = 'OPEN';
      $('aescSub').textContent = 'Students can take the exam now.';
      $('adminOpenExamBtn').style.display = 'none';
      $('adminCloseExamBtn').style.display = 'inline-block';
      $('systemExamMode').textContent = 'Open';
    } else {
      card.classList.remove('open');
      $('aescIcon').textContent = '🔒';
      $('aescStatus').textContent = 'LOCKED';
      $('aescSub').textContent = 'Students cannot take the exam.';
      $('adminOpenExamBtn').style.display = 'inline-block';
      $('adminCloseExamBtn').style.display = 'none';
      $('systemExamMode').textContent = 'Locked';
    }
    $('adminTimeLimit').value = cfg.timeLimitMinutes;
    $('adminPassThreshold').value = cfg.passThreshold;
    $('adminMaxViolations').value = cfg.maxViolations;
    $('adminShuffleTasks').value = cfg.shuffleTasks ? 'yes' : 'no';
    updateExamPreview();
  }

  function updateExamPreview() {
    const cfg = getExamConfig();
    const tl = parseInt($('adminTimeLimit').value) || cfg.timeLimitMinutes;
    const pt = parseInt($('adminPassThreshold').value) || cfg.passThreshold;
    const mv = parseInt($('adminMaxViolations').value) || cfg.maxViolations;

    $('previewTime').textContent = tl + ':00';
    $('previewTasks').textContent = cfg.tasks.length;
    $('previewPass').textContent = pt + '%';
    $('previewViolations').textContent = mv;

    if (cfg.tasks.length === 0) {
      $('examTaskBreakdown').innerHTML = 'No tasks configured yet. Go to <strong>Task Builder</strong>.';
    } else {
      const totalPoints = cfg.tasks.reduce((a, t) => a + (t.points || 10), 0);
      const types = {};
      cfg.tasks.forEach((t) => { types[t.type] = (types[t.type] || 0) + 1; });
      const typeStr = Object.entries(types).map(([k, v]) => `${v}× ${k}`).join(' · ');
      $('examTaskBreakdown').innerHTML =
        `<strong>${cfg.tasks.length}</strong> tasks · <strong>${totalPoints}</strong> total points<br>Types: ${typeStr}`;
    }
  }

  ['adminTimeLimit', 'adminPassThreshold', 'adminMaxViolations'].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener('input', updateExamPreview);
  });

  $('adminPublishCloudBtn').addEventListener('click', async () => {
    const cfg = getExamConfig();
    const timeLimit = parseInt($('adminTimeLimit').value) || 15;
    const passThreshold = parseInt($('adminPassThreshold').value) || 70;
    const maxViolations = parseInt($('adminMaxViolations').value) || 3;
    const shuffleTasks = $('adminShuffleTasks').value === 'yes';

    if (timeLimit < 1 || timeLimit > 180) { $('adminConfigMsg').textContent = '⚠️ Time 1-180 min.'; return; }
    if (passThreshold < 50 || passThreshold > 100) { $('adminConfigMsg').textContent = '⚠️ Pass 50-100.'; return; }
    if (maxViolations < 1 || maxViolations > 10) { $('adminConfigMsg').textContent = '⚠️ Violations 1-10.'; return; }

    cfg.timeLimitMinutes = timeLimit;
    cfg.passThreshold = passThreshold;
    cfg.maxViolations = maxViolations;
    cfg.shuffleTasks = shuffleTasks;
    saveExamConfig(cfg);
    updateExamPreview();

    $('adminConfigMsg').textContent = '☁️ Publishing to cloud...';
    const result = await publishConfigToCloud(cfg);
    if (result.success) {
      $('adminConfigMsg').textContent = '✅ Published! Students on all devices will see this exam.';
    } else {
      $('adminConfigMsg').textContent = '❌ Publish failed: ' + result.error;
    }
    setTimeout(() => { $('adminConfigMsg').textContent = ''; }, 5000);
  });

  $('adminOpenExamBtn').addEventListener('click', async () => {
    const cfg = getExamConfig();
    if (cfg.tasks.length === 0) {
      $('adminConfigMsg').textContent = '⚠️ Add at least one task first (Task Builder).';
      return;
    }
    cfg.isOpen = true;
    saveExamConfig(cfg);
    refreshExamStatusUI();
    $('adminConfigMsg').textContent = '☁️ Publishing exam to cloud...';

    const result = await publishConfigToCloud(cfg);
    if (result.success) {
      $('adminConfigMsg').textContent = '✅ Exam OPEN and published to all devices.';
    } else {
      $('adminConfigMsg').textContent = '⚠️ Exam open locally, cloud publish failed.';
    }
    setTimeout(() => { $('adminConfigMsg').textContent = ''; }, 4000);
  });

  $('adminCloseExamBtn').addEventListener('click', async () => {
    const cfg = getExamConfig();
    cfg.isOpen = false;
    saveExamConfig(cfg);
    refreshExamStatusUI();
    $('adminConfigMsg').textContent = '☁️ Closing exam on all devices...';

    const result = await publishConfigToCloud(cfg);
    if (result.success) {
      $('adminConfigMsg').textContent = '🔒 Exam LOCKED and synced to all devices.';
    } else {
      $('adminConfigMsg').textContent = '⚠️ Exam locked locally, cloud sync failed.';
    }
    setTimeout(() => { $('adminConfigMsg').textContent = ''; }, 4000);
  });

  // TASK BUILDER
  const taskType = $('taskType');
  const configMap = {
    crimp: 'configCrimp', topology: 'configTopology', subnet: 'configSubnet',
    firewall: 'configFirewall', ping: 'configPing', loadbalancer: 'configLB'
  };

  function showConfigFields(type) {
    Object.values(configMap).forEach((id) => { const el = $(id); if (el) el.style.display = 'none'; });
    const target = $(configMap[type]);
    if (target) target.style.display = 'block';
  }

  taskType.addEventListener('change', () => showConfigFields(taskType.value));
  showConfigFields(taskType.value);

  // Update crimp hint dynamically
  function updateCrimpHint() {
    const cableEl = $('crimpCableType');
    const stdEl = $('crimpStandard');
    const hintEl = $('crimpHint');
    if (!cableEl || !stdEl || !hintEl) return;

    const cable = cableEl.value;
    const std = stdEl.value;
    const other = std === 'A' ? 'B' : 'A';

    if (cable === 'straight') {
      hintEl.textContent = `T568${std} (this end) → T568${std} (other end)`;
    } else {
      hintEl.textContent = `T568${std} (this end) → T568${other} (other end)`;
    }
  }

  const crimpCableTypeEl = $('crimpCableType');
  const crimpStandardEl = $('crimpStandard');
  if (crimpCableTypeEl) crimpCableTypeEl.addEventListener('change', updateCrimpHint);
  if (crimpStandardEl) crimpStandardEl.addEventListener('change', updateCrimpHint);
  updateCrimpHint();

  function renderTaskList() {
    const list = $('taskList');
    if (!list) return;
    if (pendingTasks.length === 0) {
      list.innerHTML = '<div class="empty-row">No tasks yet. Add one above.</div>';
      return;
    }
    const iconMap = {
      crimp: '🔌', topology: '🌐', subnet: '🧮',
      firewall: '🛡️', ping: '📶', loadbalancer: '⚖️'
    };
    list.innerHTML = '';
    pendingTasks.forEach((t, i) => {
      const div = document.createElement('div');
      div.className = 'task-item';
      let extra = '';
      if (t.type === 'crimp') {
        const cable = t.cableType === 'crossover' ? 'Crossover' : 'Straight';
        const std = t.crimpStandard || 'B';
        const other = std === 'A' ? 'B' : 'A';
        if (t.cableType === 'crossover') {
          extra = ` · T568${std} → T568${other}`;
        } else {
          extra = ` · T568${std}`;
        }
      }
      div.innerHTML = `
        <span class="ti-icon">${iconMap[t.type] || '📝'}</span>
        <div class="ti-body">
          <div class="ti-title">${i + 1}. ${t.title}</div>
          <div class="ti-meta">Type: ${t.type}${extra}</div>
        </div>
        <span class="ti-points">${t.points} pts</span>
        <button class="ti-remove" data-idx="${i}" type="button">✖</button>
      `;
      list.appendChild(div);
    });
    list.querySelectorAll('.ti-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        pendingTasks.splice(idx, 1);
        renderTaskList();
      });
    });
  }

  $('adminAddTaskBtn').addEventListener('click', () => {
    const type = taskType.value;
    const points = parseInt($('taskPoints').value) || 10;
    const task = { type, points, id: Date.now() + Math.floor(Math.random() * 1000) };

    switch (type) {
      case 'crimp':
        task.title = $('crimpTitle').value.trim() || 'Crimping Task';
        task.cableType = $('crimpCableType').value;
        task.crimpStandard = ($('crimpStandard') && $('crimpStandard').value) || 'B';
        break;
      case 'topology':
        task.title = $('topoTitle').value.trim() || 'Build Topology';
        task.targetTopology = $('topoTarget').value;
        task.minDevices = parseInt($('topoMinDevices').value) || 4;
        break;
      case 'subnet':
        task.title = $('subnetTitle').value.trim() || 'Subnet Calculation';
        task.ip = $('subnetIP').value.trim();
        task.cidr = parseInt($('subnetCIDR').value) || 24;
        break;
      case 'firewall':
        task.title = $('fwTitle').value.trim() || 'Configure Firewall';
        task.requiredRule = $('fwRequiredRule').value;
        break;
      case 'ping':
        task.title = $('pingTitle').value.trim() || 'Ping Test';
        task.target = $('pingTaskTarget').value.trim() || '8.8.8.8';
        break;
      case 'loadbalancer':
        task.title = $('lbTitle').value.trim() || 'Load Balancer Setup';
        task.requiredAlgo = $('lbRequiredAlgo').value;
        task.minServers = parseInt($('lbMinServers').value) || 2;
        break;
    }
    pendingTasks.push(task);
    renderTaskList();
    $('taskBuilderMsg').textContent = `✅ Added: ${task.title}`;
    setTimeout(() => { $('taskBuilderMsg').textContent = ''; }, 2500);
  });

  $('adminSaveTasksBtn').addEventListener('click', async () => {
    const cfg = getExamConfig();
    cfg.tasks = pendingTasks.slice();
    saveExamConfig(cfg);
    updateExamPreview();
    $('taskListMsg').textContent = '☁️ Saving and publishing tasks...';

    const result = await publishConfigToCloud(cfg);
    if (result.success) {
      $('taskListMsg').textContent = '✅ Tasks saved and published to all devices!';
    } else {
      $('taskListMsg').textContent = '✅ Tasks saved locally (cloud failed).';
    }
    setTimeout(() => { $('taskListMsg').textContent = ''; }, 3000);
  });

  $('adminClearTasksBtn').addEventListener('click', () => {
    if (!confirm('⚠️ Remove ALL tasks?')) return;
    pendingTasks = [];
    renderTaskList();
    const cfg = getExamConfig();
    cfg.tasks = [];
    saveExamConfig(cfg);
    updateExamPreview();
  });

  // PRESETS
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.preset;
      const now = Date.now();
      if (p === 'basic') {
        pendingTasks = [
          { id: now + 1, type: 'crimp', title: 'Terminate a Straight-Through T568B Cable', cableType: 'straight', crimpStandard: 'B', points: 20 },
          { id: now + 2, type: 'crimp', title: 'Terminate a Crossover T568B→T568A Cable', cableType: 'crossover', crimpStandard: 'B', points: 20 },
          { id: now + 3, type: 'subnet', title: 'Calculate Subnet /24', ip: '192.168.1.0', cidr: 24, points: 15 }
        ];
      } else if (p === 'mixed') {
        pendingTasks = [
          { id: now + 1, type: 'crimp', title: 'Terminate a Straight-Through T568A Cable', cableType: 'straight', crimpStandard: 'A', points: 15 },
          { id: now + 2, type: 'crimp', title: 'Terminate a Straight-Through T568B Cable', cableType: 'straight', crimpStandard: 'B', points: 15 },
          { id: now + 3, type: 'crimp', title: 'Terminate a Crossover T568A→T568B Cable', cableType: 'crossover', crimpStandard: 'A', points: 20 },
          { id: now + 4, type: 'crimp', title: 'Terminate a Crossover T568B→T568A Cable', cableType: 'crossover', crimpStandard: 'B', points: 20 },
          { id: now + 5, type: 'subnet', title: 'Calculate Subnet /26', ip: '192.168.10.0', cidr: 26, points: 15 }
        ];
      } else if (p === 'network') {
        pendingTasks = [
          { id: now + 1, type: 'crimp', title: 'Terminate a Straight-Through T568B Cable', cableType: 'straight', crimpStandard: 'B', points: 15 },
          { id: now + 2, type: 'topology', title: 'Build a Star Topology', targetTopology: 'star', minDevices: 4, points: 20 },
          { id: now + 3, type: 'subnet', title: 'Calculate Subnet /26', ip: '192.168.10.0', cidr: 26, points: 15 },
          { id: now + 4, type: 'ping', title: 'Set up Internet Ping', target: '8.8.8.8', points: 15 },
          { id: now + 5, type: 'firewall', title: 'Configure HTTPS-Only Firewall', requiredRule: 'allow-https', points: 20 }
        ];
      } else if (p === 'advanced') {
        pendingTasks = [
          { id: now + 1, type: 'crimp', title: 'Terminate a Straight-Through T568A Cable', cableType: 'straight', crimpStandard: 'A', points: 10 },
          { id: now + 2, type: 'crimp', title: 'Terminate a Crossover T568A→T568B Cable', cableType: 'crossover', crimpStandard: 'A', points: 10 },
          { id: now + 3, type: 'topology', title: 'Build a Full Mesh Topology', targetTopology: 'fullmesh', minDevices: 4, points: 15 },
          { id: now + 4, type: 'subnet', title: 'Calculate Subnet /28', ip: '10.0.0.0', cidr: 28, points: 10 },
          { id: now + 5, type: 'firewall', title: 'Configure SSH-Only Firewall', requiredRule: 'allow-ssh', points: 15 },
          { id: now + 6, type: 'loadbalancer', title: 'Set Up Round-Robin Load Balancer', requiredAlgo: 'round-robin', minServers: 3, points: 20 },
          { id: now + 7, type: 'ping', title: 'Verify Internet Connectivity', target: '8.8.8.8', points: 10 }
        ];
      }
      renderTaskList();
      $('taskListMsg').textContent = '📦 Preset loaded. Click SAVE & PUBLISH.';
      setTimeout(() => { $('taskListMsg').textContent = ''; }, 3000);
    });
  });

  // RETAKE TOKEN
  function generateToken() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let token = '';
    for (let i = 0; i < 12; i++) {
      if (i > 0 && i % 4 === 0) token += '-';
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  function getTokenData() {
    try {
      const raw = localStorage.getItem('retake_token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.expires && parsed.expires < Date.now()) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function refreshTokenUI() {
    const data = getTokenData();
    if (!data) {
      $('adminRetakeToken').value = '';
      $('adminTokenStatus').value = 'No active token';
      $('adminTokenStatus').style.color = '#ff8888';
      $('adminTokenExpiry').value = '—';
      return;
    }
    $('adminRetakeToken').value = data.token;
    $('adminTokenStatus').value = '✅ Active';
    $('adminTokenStatus').style.color = '#6ee7a0';
    $('adminTokenExpiry').value = data.expires ? new Date(data.expires).toLocaleString() : 'Never';
  }

  $('adminGenerateToken').addEventListener('click', () => {
    const token = generateToken();
    const expires = Date.now() + (24 * 60 * 60 * 1000);
    localStorage.setItem('retake_token', JSON.stringify({ token, expires, createdAt: Date.now() }));
    refreshTokenUI();
    $('retakeTokenMsg').textContent = '✅ New token generated!';
    setTimeout(() => { $('retakeTokenMsg').textContent = ''; }, 3000);
  });

  $('adminCopyToken').addEventListener('click', () => {
    const token = $('adminRetakeToken').value;
    if (!token) {
      $('retakeTokenMsg').textContent = '⚠️ No token. Generate one first.';
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(token).then(() => {
        $('retakeTokenMsg').textContent = '📋 Token copied!';
        setTimeout(() => { $('retakeTokenMsg').textContent = ''; }, 2500);
      }).catch(() => fallbackCopy(token));
    } else {
      fallbackCopy(token);
    }
  });

  function fallbackCopy(token) {
    const input = $('adminRetakeToken');
    input.select();
    input.setSelectionRange(0, 99999);
    try {
      document.execCommand('copy');
      $('retakeTokenMsg').textContent = '📋 Token copied!';
    } catch (e) {
      $('retakeTokenMsg').textContent = '⚠️ Copy manually: ' + token;
    }
    setTimeout(() => { $('retakeTokenMsg').textContent = ''; }, 3000);
  }

  $('adminRevokeToken').addEventListener('click', () => {
    if (!confirm('Revoke the current retake token?')) return;
    localStorage.removeItem('retake_token');
    refreshTokenUI();
    $('retakeTokenMsg').textContent = '🚫 Token revoked.';
    setTimeout(() => { $('retakeTokenMsg').textContent = ''; }, 2500);
  });

  // STUDENT RESULTS
  async function refreshResultsTable() {
    const body = $('adminResultsTableBody');
    body.innerHTML = '<tr><td colspan="7" class="empty-row">Loading from cloud...</td></tr>';

    let results = [];
    const cloudRes = await fetchResultsFromCloud();

    if (cloudRes.success && cloudRes.results.length > 0) {
      results = cloudRes.results;
    } else {
      try {
        results = JSON.parse(localStorage.getItem('exam_history') || '[]');
      } catch (e) { results = []; }
    }

    const total = results.length;
    const passed = results.filter((h) => h.passed).length;
    const failed = total - passed;
    const avgScore = total > 0 ? Math.round(results.reduce((a, h) => a + (h.score || 0), 0) / total) : 0;

    $('adminTotalAttempts').textContent = total;
    $('adminTotalPassed').textContent = passed;
    $('adminTotalFailed').textContent = failed;
    $('adminAvgScore').textContent = total > 0 ? avgScore + '%' : '—';
    $('systemAttempts').textContent = total;

    if (total === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty-row">No exam results yet.</td></tr>';
      return;
    }

    body.innerHTML = '';
    results.slice().reverse().forEach((h, idx) => {
      const date = new Date(h.timestamp);
      const dateStr = isNaN(date.getTime()) ? '—'
        : date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(h.studentName || 'Unknown')}</td>
        <td>${escapeHtml(h.studentId || '—')}</td>
        <td><strong>${h.score || 0}%</strong></td>
        <td><span class="${h.passed ? 'badge-pass' : 'badge-fail'}">${h.passed ? 'PASSED' : 'FAILED'}</span></td>
        <td>${h.violations || 0}</td>
        <td>${dateStr}</td>
      `;
      body.appendChild(row);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  $('adminRefreshResults').addEventListener('click', refreshResultsTable);
  $('adminOpenSheet').addEventListener('click', () => {
    window.open('https://docs.google.com/spreadsheets/d/1PCniBYfuKfVbktsTArc5NiJ8zsKWzACVlRlcNKos0so/edit', '_blank');
  });

  // INIT
  function init() {
    refreshExamStatusUI();
    renderTaskList();
    showConfigFields(taskType.value);
    refreshTokenUI();
    updateCrimpHint();

    const cfg = getSheetConfig();
    const urlEl = $('systemWebhookUrl');
    if (urlEl) {
      urlEl.textContent = cfg.url
        ? (cfg.url.substring(0, 60) + '...')
        : 'Not configured';
    }
    const statusEl = $('systemSheetStatus');
    if (statusEl) {
      statusEl.textContent = cfg.url ? 'Configured ✅' : 'Not Configured ❌';
    }

    $('adminResultsTableBody').innerHTML =
      '<tr><td colspan="7" class="empty-row">Click "Refresh from Cloud" to load.</td></tr>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
};

/* ============================================================
   STUDENT PAGE
   ============================================================ */
window.initStudentPage = function () {
  const $ = (id) => document.getElementById(id);

  function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    if (tab === 'crimp') {
      $('tabCrimpBtn').classList.add('active');
      $('crimpTab').classList.add('active');
    } else if (tab === 'topo') {
      $('tabTopoBtn').classList.add('active');
      $('topoTab').classList.add('active');
      if (window.redrawTopo) window.redrawTopo();
    } else if (tab === 'assess') {
      $('tabAssessBtn').classList.add('active');
      $('assessTab').classList.add('active');
      if (window.refreshExamScreen) window.refreshExamScreen();
      if (typeof window.__pollCloudConfig === 'function') setTimeout(window.__pollCloudConfig, 300);
    }
  }

  $('tabCrimpBtn').addEventListener('click', () => {
    if (window.examActive && window.examActive()) return;
    switchTab('crimp');
  });
  $('tabTopoBtn').addEventListener('click', () => {
    if (window.examActive && window.examActive()) return;
    switchTab('topo');
  });
  $('tabAssessBtn').addEventListener('click', () => {
    if (window.examActive && window.examActive()) return;
    switchTab('assess');
  });

  // ==================== CRIMPING PRACTICE ====================
  (function () {
    let cableType = 'straight';
    let practiceStd = 'B'; // Default practice standard
    let shuffledPalette = [];
    let slotWires = new Array(8).fill(null);
    let selectedSlot = -1;
    let selectedPaletteIdx = 0;
    let isCrimped = false;
    let stats = JSON.parse(localStorage.getItem('crimp_stats_v2') ||
      '{"attempts":0,"passed":0,"failed":0,"scores":[]}');

    function getCurrentSequence() {
      return WIRE_STANDARDS[practiceStd];
    }

    function shuffleArray(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function updateStats() {
      $('statAttempts').textContent = stats.attempts;
      $('statPassed').textContent = stats.passed;
      $('statFailed').textContent = stats.failed;
      if (stats.scores.length > 0) {
        const avg = stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length;
        $('statAvgScore').textContent = Math.round(avg) + '%';
      } else $('statAvgScore').textContent = '—';
    }

    function updatePracticeTitle() {
      const cable = cableType === 'straight' ? 'STRAIGHT-THROUGH' : 'CROSSOVER';
      const std = `T568${practiceStd}`;
      const other = practiceStd === 'A' ? 'B' : 'A';
      if (cableType === 'straight') {
        $('rj45Title').textContent = `RJ45 CONNECTOR — ${std} ${cable}`;
        $('taskBanner').innerHTML = `<strong>TASK:</strong> Terminate a <strong>Straight-Through</strong> cable using <strong>${std}</strong> on both ends.`;
      } else {
        $('rj45Title').textContent = `RJ45 CONNECTOR — ${std} → T568${other} ${cable}`;
        $('taskBanner').innerHTML = `<strong>TASK:</strong> Terminate a <strong>Crossover</strong> cable — this end <strong>${std}</strong>, other end <strong>T568${other}</strong>.`;
      }
    }

    function buildPalette() {
      const wp = $('wirePalette');
      wp.innerHTML = '';
      const seq = getCurrentSequence();
      shuffledPalette = shuffleArray(seq);
      shuffledPalette.forEach((wire, idx) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        if (wire.stripe) {
          item.style.background = wire.base;
          const stripe = document.createElement('div');
          stripe.className = 'stripe-overlay';
          item.appendChild(stripe);
        } else item.style.background = wire.hex;
        item.title = wire.name;
        if (idx === selectedPaletteIdx) item.classList.add('active-palette');
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isCrimped) { $('feedbackMsg').textContent = '⛔ Crimped. Reset to change.'; return; }
          selectedPaletteIdx = idx;
          document.querySelectorAll('#wirePalette .palette-item').forEach((el, i) => {
            el.classList.toggle('active-palette', i === idx);
          });
          if (selectedSlot !== -1) placeWireInSlot(selectedSlot, idx);
          else $('feedbackMsg').textContent = `Selected: ${wire.name}. Click a slot.`;
        });
        wp.appendChild(item);
      });
    }

    function buildPins() {
      const pc = $('pinContainer');
      pc.innerHTML = '';
      for (let i = 1; i <= 8; i++) {
        const pin = document.createElement('div');
        pin.className = 'pin';
        pin.textContent = i;
        pin.addEventListener('click', () => { if (!isCrimped) selectSlot(i - 1); });
        pc.appendChild(pin);
      }
    }

    function buildWireSlots() {
      const wc = $('wireSlotContainer');
      wc.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const row = document.createElement('div');
        row.className = 'wire-row';
        const label = document.createElement('span');
        label.className = 'slot-label';
        label.textContent = `${i + 1}`;
        const indicator = document.createElement('div');
        indicator.className = 'wire-indicator';
        indicator.dataset.slotIndex = i;
        const fill = document.createElement('div');
        fill.className = 'wire-fill';
        indicator.appendChild(fill);
        const wireLabel = document.createElement('span');
        wireLabel.className = 'wire-label';
        indicator.appendChild(wireLabel);
        indicator.addEventListener('click', (e) => { e.stopPropagation(); if (!isCrimped) selectSlot(i); });
        row.appendChild(label);
        row.appendChild(indicator);
        wc.appendChild(row);
      }
    }

    function updateSlotVisual(slotIdx) {
      const ind = document.querySelector(`#wireSlotContainer .wire-indicator[data-slot-index="${slotIdx}"]`);
      if (!ind) return;
      const fill = ind.querySelector('.wire-fill');
      const lbl = ind.querySelector('.wire-label');
      const wire = slotWires[slotIdx];
      if (wire) {
        ind.classList.add('filled');
        if (wire.stripe) {
          fill.style.background = `repeating-linear-gradient(90deg, ${wire.base} 0px, ${wire.base} 4px, ${wire.second} 4px, ${wire.second} 8px)`;
        } else fill.style.background = wire.hex;
        fill.style.width = '100%';
        lbl.textContent = wire.name;
      } else {
        ind.classList.remove('filled');
        fill.style.width = '0%';
        lbl.textContent = '';
      }
    }

    function selectSlot(slotIdx) {
      if (isCrimped) return;
      selectedSlot = slotIdx;
      document.querySelectorAll('#wireSlotContainer .wire-indicator').forEach((el, idx) => {
        if (idx === slotIdx) {
          el.style.outline = '3px solid #ffb347';
          el.style.outlineOffset = '2px';
          el.style.boxShadow = '0 0 15px #ffb347';
        } else {
          el.style.outline = 'none';
          el.style.boxShadow = 'none';
        }
      });
      document.querySelectorAll('#pinContainer .pin').forEach((pin, idx) => {
        pin.classList.toggle('selected', idx === slotIdx);
      });
      $('feedbackMsg').textContent = `Slot ${slotIdx + 1} selected.`;
    }

    function placeWireInSlot(slotIdx, paletteIdx) {
      if (isCrimped) return;
      const wt = shuffledPalette[paletteIdx];
      if (!wt) return;
      slotWires[slotIdx] = { ...wt };
      updateSlotVisual(slotIdx);
      $('feedbackMsg').textContent = `Placed ${wt.name} in slot ${slotIdx + 1}`;
      if (slotWires.every((w) => w !== null)) {
        $('stepWiring').classList.add('done');
        $('stepCrimp').classList.add('active');
        $('statusMessage').textContent = '✅ All wires placed. Now CRIMP.';
      }
    }

    function resetAll() {
      slotWires = new Array(8).fill(null);
      selectedSlot = -1;
      selectedPaletteIdx = 0;
      isCrimped = false;
      for (let i = 0; i < 8; i++) updateSlotVisual(i);
      document.querySelectorAll('#pinContainer .pin').forEach((p) => p.classList.remove('selected', 'active'));
      document.querySelectorAll('#wirePalette .palette-item').forEach((el, i) => {
        el.classList.toggle('active-palette', i === 0);
        el.style.pointerEvents = 'auto';
      });
      document.querySelectorAll('#wireSlotContainer .wire-indicator').forEach((el) => {
        el.style.pointerEvents = 'auto';
        el.style.outline = 'none';
        el.style.boxShadow = 'none';
      });
      document.querySelectorAll('#pinContainer .pin').forEach((el) => el.style.pointerEvents = 'auto');
      $('crimpBtn').disabled = false;
      $('verifyBtn').disabled = false;
      $('stepWiring').classList.add('active');
      $('stepWiring').classList.remove('done');
      $('stepCrimp').classList.remove('active', 'done');
      $('stepVerify').classList.remove('active', 'done');
      $('statusMessage').textContent = '🧵 Step 1: Place all 8 wires.';
      $('statusMessage').className = 'status-area';
      $('feedbackMsg').textContent = 'Pick a wire color, then click a slot.';
      $('resultOutputBody').className = 'result-output-body';
      $('resultOutputBody').innerHTML = '<span class="result-placeholder">Awaiting crimp & test...</span>';
      updatePracticeTitle();
      buildPalette();
    }

    function crimp() {
      if (isCrimped) return;
      if (slotWires.some((w) => w === null)) {
        $('feedbackMsg').textContent = '⚠️ Some slots are empty.';
        $('statusMessage').textContent = '❌ Missing wires.';
        $('statusMessage').className = 'status-area error';
        return;
      }
      isCrimped = true;
      document.querySelectorAll('#pinContainer .pin').forEach((pin) => pin.classList.add('active'));
      document.querySelectorAll('#wirePalette .palette-item').forEach((el) => el.style.pointerEvents = 'none');
      document.querySelectorAll('#wireSlotContainer .wire-indicator').forEach((el) => el.style.pointerEvents = 'none');
      document.querySelectorAll('#pinContainer .pin').forEach((el) => el.style.pointerEvents = 'none');
      $('crimpBtn').disabled = true;
      $('stepCrimp').classList.add('done');
      $('stepVerify').classList.add('active');
      $('statusMessage').textContent = '🔨 Step 2 complete. Now CHECK.';
      $('statusMessage').className = 'status-area';
      $('feedbackMsg').textContent = 'Click CHECK CABLE to test.';
    }

    function checkCable() {
      if (!isCrimped) { $('feedbackMsg').textContent = '⚠️ Crimp first.'; return; }
      const seq = getCurrentSequence();
      let correct = 0;
      const results = [];
      for (let i = 0; i < 8; i++) {
        const ok = slotWires[i] && slotWires[i].name === seq[i].name;
        if (ok) correct++;
        results.push({ pin: i + 1, ok });
      }
      const allCorrect = correct === 8;
      const score = Math.round((correct / 8) * 100);
      stats.attempts++;
      if (allCorrect) stats.passed++; else stats.failed++;
      stats.scores.push(score);
      localStorage.setItem('crimp_stats_v2', JSON.stringify(stats));
      updateStats();
      $('stepVerify').classList.add('done');
      $('stepVerify').classList.remove('active');
      const cableLabel = cableType === 'straight' ? 'Straight-Through' : 'Crossover';
      const stdLabel = `T568${practiceStd}`;

      if (allCorrect) {
        $('statusMessage').textContent = `✅ CORRECT — ${stdLabel} ${cableLabel}!`;
        $('statusMessage').className = 'status-area ok';
        $('feedbackMsg').textContent = `All 8 wires match ${stdLabel}.`;
        $('resultOutputBody').className = 'result-output-body pass';
        $('resultOutputBody').innerHTML = `
          <div><span class="result-icon">✅</span>
          <div>CORRECT CONNECTION</div>
          <div class="result-details">
            <strong>Cable Type:</strong> ${cableLabel}<br>
            <strong>Standard:</strong> ${stdLabel}<br>
            <strong>Wired End:</strong> 8/8 correct<br>
            <strong>Status:</strong> Link established ✓
          </div></div>`;
      } else {
        const wrongPins = results.filter((r) => !r.ok).map((r) => r.pin).join(', ');
        $('statusMessage').textContent = `❌ INCORRECT — ${correct}/8.`;
        $('statusMessage').className = 'status-area error';
        $('feedbackMsg').textContent = `Wrong pins: ${wrongPins}.`;
        $('resultOutputBody').className = 'result-output-body fail';
        $('resultOutputBody').innerHTML = `
          <div><span class="result-icon">❌</span>
          <div>INCORRECT CONNECTION</div>
          <div class="result-details">
            <strong>Cable Type:</strong> ${cableLabel}<br>
            <strong>Standard:</strong> ${stdLabel}<br>
            <strong>Wired End:</strong> ${correct}/8 correct<br>
            <strong>Wrong Pins:</strong> ${wrongPins}<br>
            <strong>Status:</strong> No link ✗
          </div></div>`;
      }
    }

    function setCableType(type) {
      if (isCrimped) { $('feedbackMsg').textContent = 'Reset first.'; return; }
      cableType = type;
      $('cableStraight').classList.toggle('active', type === 'straight');
      $('cableCrossover').classList.toggle('active', type === 'crossover');
      updatePracticeTitle();
      resetAll();
    }

    function setPracticeStd(std) {
      if (isCrimped) { $('feedbackMsg').textContent = 'Reset first.'; return; }
      practiceStd = std;
      const elA = $('cableStdA');
      const elB = $('cableStdB');
      if (elA) elA.classList.toggle('active', std === 'A');
      if (elB) elB.classList.toggle('active', std === 'B');
      updatePracticeTitle();
      resetAll();
    }

    $('resetBtn').addEventListener('click', resetAll);
    $('randomizeBtn').addEventListener('click', () => {
      if (isCrimped) { $('feedbackMsg').textContent = 'Reset first.'; return; }
      buildPalette();
      $('feedbackMsg').textContent = '🎲 Palette randomized!';
    });
    $('crimpBtn').addEventListener('click', crimp);
    $('verifyBtn').addEventListener('click', checkCable);
    $('cableStraight').addEventListener('click', () => setCableType('straight'));
    $('cableCrossover').addEventListener('click', () => setCableType('crossover'));

    const stdA = $('cableStdA');
    const stdB = $('cableStdB');
    if (stdA) stdA.addEventListener('click', () => setPracticeStd('A'));
    if (stdB) stdB.addEventListener('click', () => setPracticeStd('B'));

    buildPins();
    buildWireSlots();
    buildPalette();
    resetAll();
    updateStats();
  })();

  // ==================== ASSESSMENT EXAM ====================
  (function () {
    let examActive = false;
    let examFinished = false;
    let examTasks = [];
    let currentTaskIdx = 0;
    let taskResults = [];
    let pointsEarned = 0;
    let pointsTotal = 0;
    let violations = 0;
    let timeRemaining = 900;
    let timerInterval = null;
    let studentName = '';
    let studentId = '';
    let maxViolations = 3;
    let passThreshold = 70;
    let shuffledPalette = [];
    let slotWires = new Array(8).fill(null);
    let selectedSlot = -1;
    let selectedPaletteIdx = 0;
    let currentLab = null;
    let lastConfigHash = '';
    let pollTimer = null;
    let currentCrimpStandard = 'B';

    function shuffleArray(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function formatTime(sec) {
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      return `${m}:${s}`;
    }
    function ipToLong(ip) {
      const p = ip.split('.').map(Number);
      if (p.length !== 4 || p.some((x) => isNaN(x) || x < 0 || x > 255)) return null;
      return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
    }
    function longToIp(l) {
      return [(l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255].join('.');
    }
    function configHash(cfg) {
      try {
        return JSON.stringify({
          isOpen: cfg.isOpen, t: cfg.tasks.length,
          tl: cfg.timeLimitMinutes, p: cfg.passThreshold, m: cfg.maxViolations
        });
      } catch (e) { return ''; }
    }

    // ============ LAB HELPERS ============
    const LAB_STYLE = {
      pc: { icon: '💻', color: '#5a6a7a', label: 'PC' },
      server: { icon: '🖥️', color: '#7a6a9a', label: 'Server' },
      switch: { icon: '🔀', color: '#4a9b8e', label: 'Switch' },
      router: { icon: '📡', color: '#3a7ca5', label: 'Router' },
      firewall: { icon: '🛡️', color: '#a55a4a', label: 'Firewall' },
      lb: { icon: '⚖️', color: '#8a6a3a', label: 'LoadBalancer' },
      internet: { icon: '🌍', color: '#2a6a9a', label: 'Internet' }
    };

    function createLab(canvasId, deviceTypes) {
      const canvas = $(canvasId);
      const cloned = canvas.cloneNode(true);
      canvas.parentNode.replaceChild(cloned, canvas);

      const ctx = cloned.getContext('2d');
      cloned.width = 700;
      cloned.height = 380;

      return {
        canvas: cloned,
        ctx,
        devices: [],
        connections: [],
        tool: 'connect',
        deviceType: deviceTypes[0] || 'pc',
        dragDeviceId: null,
        dragOffsetX: 0,
        dragOffsetY: 0,
        connectSourceId: null,
        nextId: 1,
        deviceTypes,
        listeners: []
      };
    }

    function cleanupLab(lab) {
      if (!lab) return;
      if (Array.isArray(lab.listeners)) {
        lab.listeners.forEach(({ el, type, fn }) => {
          try { el.removeEventListener(type, fn); } catch (e) {}
        });
      }
      lab.listeners = [];
      lab.devices = [];
      lab.connections = [];
      lab.connectSourceId = null;
      lab.dragDeviceId = null;
      currentLab = null;
    }

    function labDraw(lab) {
      const { ctx, canvas, devices, connections, tool, connectSourceId } = lab;
      const CW = canvas.width, CH = canvas.height;
      ctx.clearRect(0, 0, CW, CH);
      ctx.strokeStyle = '#1a2c38';
      ctx.lineWidth = 1;
      for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
      for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }

      connections.forEach((conn) => {
        const a = devices.find((d) => d.id === conn.from);
        const b = devices.find((d) => d.id === conn.to);
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = '#4a8aaa';
        ctx.lineWidth = 4;
        ctx.stroke();
      });

      if (tool === 'connect' && connectSourceId !== null) {
        const s = devices.find((d) => d.id === connectSourceId);
        if (s) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffb347';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      devices.forEach((d) => {
        const style = LAB_STYLE[d.type];
        if (!style) return;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 28, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();
        ctx.strokeStyle = '#2a4a5a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '24px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(style.icon, d.x, d.y - 2);
        ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#d0e8f5';
        ctx.fillText(d.label || style.label, d.x, d.y + 38);
      });
    }

    function labAttach(lab) {
      const canvas = lab.canvas;

      const mousedown = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const sx = canvas.width / rect.width;
        const sy = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * sx;
        const y = (e.clientY - rect.top) * sy;

        const hit = lab.devices.find((d) => Math.hypot(x - d.x, y - d.y) < 30);

        if (lab.tool === 'delete') {
          if (hit) {
            lab.devices = lab.devices.filter((d) => d.id !== hit.id);
            lab.connections = lab.connections.filter((c) => c.from !== hit.id && c.to !== hit.id);
            labDraw(lab);
          }
          return;
        }

        if (lab.tool === 'connect') {
          if (hit) {
            if (lab.connectSourceId === null) {
              lab.connectSourceId = hit.id;
            } else if (lab.connectSourceId === hit.id) {
              lab.connectSourceId = null;
            } else {
              const exists = lab.connections.some((c) =>
                (c.from === lab.connectSourceId && c.to === hit.id) ||
                (c.from === hit.id && c.to === lab.connectSourceId));
              if (!exists) lab.connections.push({ from: lab.connectSourceId, to: hit.id });
              lab.connectSourceId = null;
            }
            labDraw(lab);
          } else {
            const style = LAB_STYLE[lab.deviceType];
            if (!style) return;
            lab.devices.push({
              id: lab.nextId++,
              type: lab.deviceType,
              x: Math.min(Math.max(x, 40), canvas.width - 40),
              y: Math.min(Math.max(y, 40), canvas.height - 40),
              label: `${style.label}${lab.nextId - 1}`
            });
            labDraw(lab);
          }
          return;
        }

        if (lab.tool === 'select' && hit) {
          lab.dragDeviceId = hit.id;
          lab.dragOffsetX = x - hit.x;
          lab.dragOffsetY = y - hit.y;
        }
      };

      const mousemove = (e) => {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const sx = canvas.width / rect.width;
        const sy = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * sx;
        const y = (e.clientY - rect.top) * sy;

        if (lab.dragDeviceId) {
          const d = lab.devices.find((dev) => dev.id === lab.dragDeviceId);
          if (d) {
            d.x = Math.min(Math.max(x - lab.dragOffsetX, 40), canvas.width - 40);
            d.y = Math.min(Math.max(y - lab.dragOffsetY, 40), canvas.height - 40);
            labDraw(lab);
          }
        }
      };

      const mouseup = () => { lab.dragDeviceId = null; };
      const mouseleave = () => { lab.dragDeviceId = null; };

      canvas.addEventListener('mousedown', mousedown);
      canvas.addEventListener('mousemove', mousemove);
      canvas.addEventListener('mouseup', mouseup);
      canvas.addEventListener('mouseleave', mouseleave);

      lab.listeners = [
        { el: canvas, type: 'mousedown', fn: mousedown },
        { el: canvas, type: 'mousemove', fn: mousemove },
        { el: canvas, type: 'mouseup', fn: mouseup },
        { el: canvas, type: 'mouseleave', fn: mouseleave }
      ];
    }

    function detectLabTopology(lab) {
      const devices = lab.devices, connections = lab.connections;
      const n = devices.length, e = connections.length;
      if (n === 0) return 'none';
      if (n === 1) return 'single';
      if (e === 0) return 'isolated';
      const degrees = {};
      devices.forEach((d) => degrees[d.id] = 0);
      connections.forEach((c) => {
        if (degrees[c.from] !== undefined) degrees[c.from]++;
        if (degrees[c.to] !== undefined) degrees[c.to]++;
      });
      const dv = Object.values(degrees);
      const adj = {};
      devices.forEach((d) => adj[d.id] = []);
      connections.forEach((c) => {
        if (adj[c.from]) adj[c.from].push(c.to);
        if (adj[c.to]) adj[c.to].push(c.from);
      });
      function bfs(start) {
        const v = new Set([start]), q = [start];
        while (q.length) {
          const node = q.shift();
          (adj[node] || []).forEach((nb) => { if (!v.has(nb)) { v.add(nb); q.push(nb); } });
        }
        return v;
      }
      const visited = bfs(devices[0].id);
      const connected = visited.size === n;
      if (!connected) return 'disconnected';
      if (n === 2 && e === 1) return 'point';
      const starHub = dv.filter((d) => d > 2).length === 1;
      const allLeaf = dv.filter((d) => d === 1).length === n - 1;
      if (starHub && allLeaf && n >= 3) return 'star';
      const maxEdges = (n * (n - 1)) / 2;
      if (e === maxEdges && n >= 3) return 'fullmesh';
      const allDeg2 = dv.every((d) => d === 2);
      if (allDeg2 && n >= 3 && e === n) return 'ring';
      const deg1 = dv.filter((d) => d === 1).length;
      const deg2 = dv.filter((d) => d === 2).length;
      if (deg1 === 2 && deg2 === n - 2 && e === n - 1 && n >= 3) return 'bus';
      if (e === n - 1) return 'tree';
      return 'hybrid';
    }

    function setupExamLabToolbar(deviceTypes) {
      const bar = $('examLabDeviceBar');
      const cloned = bar.cloneNode(true);
      bar.parentNode.replaceChild(cloned, bar);

      deviceTypes.forEach((type, i) => {
        const style = LAB_STYLE[type];
        if (!style) return;
        const btn = document.createElement('button');
        btn.className = 'pt-device-btn' + (i === 0 ? ' selected' : '');
        btn.type = 'button';
        btn.innerHTML = `<span class="icon">${style.icon}</span> ${style.label}`;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          cloned.querySelectorAll('.pt-device-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          if (currentLab) currentLab.deviceType = type;
        });
        cloned.appendChild(btn);
      });

      const toolsBar = $('examLabToolsBar');
      if (toolsBar) {
        const toolsClone = toolsBar.cloneNode(true);
        toolsBar.parentNode.replaceChild(toolsClone, toolsBar);

        toolsClone.querySelectorAll('.tool-btn[data-exam-tool]').forEach((btn) => {
          const toolName = btn.dataset.examTool;
          btn.classList.toggle('active', toolName === 'connect');
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toolsClone.querySelectorAll('.tool-btn[data-exam-tool]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            if (currentLab) currentLab.tool = toolName;
          });
        });

        const clearBtn = toolsClone.querySelector('#examLabClear');
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentLab) return;
            currentLab.devices = [];
            currentLab.connections = [];
            currentLab.connectSourceId = null;
            currentLab.dragDeviceId = null;
            labDraw(currentLab);
          });
        }
      }
    }

    // ============ EXAM SCREEN ============
    window.refreshExamScreen = function () {
      const cfg = getExamConfig();
      $('examLockedScreen').style.display = 'none';
      $('examReadyScreen').style.display = 'none';
      $('examActiveScreen').style.display = 'none';
      $('examResultsScreen').style.display = 'none';

      if (!cfg.isOpen) {
        $('examLockedScreen').style.display = 'flex';
      } else if (!examActive && !examFinished) {
        $('examReadyScreen').style.display = 'flex';
        $('examConfigTime').textContent = cfg.timeLimitMinutes + ':00';
        $('examConfigTasks').textContent = cfg.tasks.length;
        $('examConfigPass').textContent = cfg.passThreshold + '%';
        $('examConfigViolations').textContent = cfg.maxViolations;
        $('rulesMaxViolations').textContent = cfg.maxViolations;
        $('rulesTasks').textContent = cfg.tasks.length;
        $('rulesPass').textContent = cfg.passThreshold + '%';
        $('confirmName').value = '';
        $('confirmId').value = '';
      } else if (examActive) {
        $('examActiveScreen').style.display = 'block';
      } else if (examFinished) {
        $('examResultsScreen').style.display = 'flex';
      }
    };

    $('examRefreshBtn').addEventListener('click', async () => {
      const btn = $('examRefreshBtn');
      const statusEl = $('pollStatus');
      const orig = btn.textContent;
      btn.textContent = '🔄 Syncing...';
      btn.disabled = true;
      if (statusEl) statusEl.textContent = 'Contacting cloud...';

      try {
        const res = await syncConfigFromCloud();
        if (res.success && res.config) {
          if (statusEl) statusEl.textContent = '✅ Config received! Updating view...';
          lastConfigHash = configHash(res.config);
        } else if (res.success && !res.config) {
          if (statusEl) statusEl.textContent = '⚠️ No config in cloud yet. Ask admin to publish.';
        } else {
          if (statusEl) statusEl.textContent = '❌ Cloud sync failed: ' + (res.error || 'unknown');
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = '❌ Error: ' + e.message;
      }
      btn.textContent = orig;
      btn.disabled = false;
      window.refreshExamScreen();
    });

    async function pollCloudConfig() {
      if (examActive || examFinished) return;
      const assessTab = $('assessTab');
      const isOnAssess = assessTab && assessTab.classList.contains('active');
      if (!isOnAssess) return;

      try {
        const res = await syncConfigFromCloud();
        if (res.success && res.config) {
          const hash = configHash(res.config);
          if (hash !== lastConfigHash) {
            lastConfigHash = hash;
            window.refreshExamScreen();
            const statusEl = $('pollStatus');
            if (statusEl) statusEl.textContent = '✅ Config updated!';
          }
        }
      } catch (err) {}
    }

    window.__pollCloudConfig = pollCloudConfig;

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollCloudConfig, 15000);
      setTimeout(pollCloudConfig, 1500);
    }

    startPolling();
    window.addEventListener('beforeunload', () => { if (pollTimer) clearInterval(pollTimer); });

    $('examStartBtn').addEventListener('click', () => {
      const cfg = getExamConfig();
      if (!cfg.isOpen) { $('examWarning').textContent = '⚠️ Exam not available.'; return; }
      if (!cfg.tasks || cfg.tasks.length === 0) {
        $('examWarning').textContent = '⚠️ No tasks configured. Contact your instructor.';
        return;
      }
      const cName = $('confirmName').value.trim();
      const cId = $('confirmId').value.trim();
      const user = JSON.parse(localStorage.getItem('current_user') || '{}');
      if (!cName || !cId) { $('examWarning').textContent = '⚠️ Confirm name and ID.'; return; }
      if (cName.toLowerCase() !== (user.name || '').toLowerCase() || cId !== user.id) {
        $('examWarning').textContent = '⚠️ Name/ID does not match login.';
        return;
      }
      $('examWarning').textContent = '';
      studentName = user.name;
      studentId = user.id;
      startExam();
    });

    function startExam() {
      const cfg = getExamConfig();
      examActive = true;
      examFinished = false;
      currentTaskIdx = 0;
      taskResults = [];
      pointsEarned = 0;
      violations = 0;
      timeRemaining = cfg.timeLimitMinutes * 60;
      maxViolations = cfg.maxViolations;
      passThreshold = cfg.passThreshold;

      let list = cfg.tasks.map((t) => ({ ...t, id: t.id || (Date.now() + Math.random()) }));
      if (cfg.shuffleTasks) list = shuffleArray(list);
      examTasks = list;
      pointsTotal = examTasks.reduce((a, t) => a + (t.points || 10), 0);

      $('examStudentName').textContent = studentName;
      $('examStudentId').textContent = 'ID: ' + studentId;
      $('examTotalChallenges').textContent = examTasks.length;

      $('examLockedScreen').style.display = 'none';
      $('examReadyScreen').style.display = 'none';
      $('examActiveScreen').style.display = 'block';
      $('examResultsScreen').style.display = 'none';

      requestFullscreen();
      activateAntiCheat();
      startTimer();
      loadTask();
      updateExamHeader();
    }

    function requestFullscreen() {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) el.msRequestFullscreen();
    }
    function exitFullscreen() {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }

    let antiCheatActive = false;
    let hiddenTimer = null;

    function activateAntiCheat() {
      antiCheatActive = true;
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('blur', handleWindowBlur);
      document.addEventListener('contextmenu', preventContextMenu);
      document.addEventListener('keydown', preventShortcuts);
    }
    function deactivateAntiCheat() {
      antiCheatActive = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('contextmenu', preventContextMenu);
      document.removeEventListener('keydown', preventShortcuts);
      $('anticheatOverlay').style.display = 'none';
    }
    function handleVisibilityChange() {
      if (!antiCheatActive || !examActive || examFinished) return;
      if (document.hidden) recordViolation('Tab switch / window hidden');
    }
    function handleWindowBlur() {
      if (!antiCheatActive || !examActive || examFinished) return;
      clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(() => {
        if (antiCheatActive && examActive && !examFinished) {
          recordViolation('Window lost focus (Alt+Tab detected)');
        }
      }, 200);
    }
    function preventContextMenu(e) { if (antiCheatActive && examActive) { e.preventDefault(); return false; } }
    function preventShortcuts(e) {
      if (!antiCheatActive || !examActive) return;
      if (e.altKey && e.key === 'Tab') { e.preventDefault(); recordViolation('Alt+Tab blocked'); return false; }
      if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); recordViolation('Ctrl+Tab blocked'); return false; }
      if (e.metaKey) { e.preventDefault(); return false; }
      if (e.key === 'F11') { e.preventDefault(); return false; }
      if (e.ctrlKey && ['c', 'v', 'x', 'a'].includes(e.key.toLowerCase())) { e.preventDefault(); return false; }
      if (e.key === 'Escape') { e.preventDefault(); return false; }
    }

    function recordViolation(reason) {
      if (!examActive || examFinished) return;
      violations++;
      updateExamHeader();
      $('violationText').textContent = `${reason} — Violation ${violations} of ${maxViolations}.`;
      $('violationBanner').classList.add('show');
      setTimeout(() => $('violationBanner').classList.remove('show'), 5000);
      $('anticheatOverlay').style.display = 'flex';
      if (violations < maxViolations) {
        setTimeout(() => { $('anticheatOverlay').style.display = 'none'; }, 2500);
      } else {
        setTimeout(() => {
          $('anticheatOverlay').style.display = 'none';
          endExam(true, 'Auto-submitted: too many violations');
        }, 2500);
      }
    }

    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        timeRemaining--;
        $('examTimer').textContent = formatTime(Math.max(0, timeRemaining));
        if (timeRemaining <= 60) $('examTimer').classList.add('danger');
        else $('examTimer').classList.remove('danger');
        if (timeRemaining <= 0) {
          clearInterval(timerInterval);
          endExam(true, 'Time expired');
        }
      }, 1000);
      $('examTimer').textContent = formatTime(timeRemaining);
    }

    function updateExamHeader() {
      $('examCurrentChallenge').textContent = Math.min(currentTaskIdx + 1, examTasks.length);
      $('examProgressFill').style.width = (currentTaskIdx / examTasks.length * 100) + '%';
      $('examViolations').textContent = `${violations} / ${maxViolations} violations`;
      $('examViolations').classList.toggle('has-violation', violations > 0);
      $('examScoreDisplay').textContent = pointsTotal > 0
        ? Math.round((pointsEarned / pointsTotal) * 100) + '%' : '0%';
      $('examPointsDisplay').textContent = `${pointsEarned} / ${pointsTotal}`;
    }

    function hideAllTaskUIs() {
      ['examCrimpUI', 'examLabUI', 'examSubnetUI', 'examFirewallUI', 'examPingUI', 'examLBUI']
        .forEach((id) => { const el = $(id); if (el) el.style.display = 'none'; });
      $('examSubnetNetwork').value = '';
      $('examSubnetBroadcast').value = '';
      $('examSubnetMask').value = '';
      $('examSubnetFirst').value = '';
      $('examSubnetLast').value = '';
      $('examFwRule').value = '';
      $('examLBRule').value = '';
      $('examPingOutput').textContent = 'Build the topology, then click Run Ping.';
      $('examLBOutput').textContent = 'Configure topology and algorithm, then simulate.';
      if (currentLab && currentLab.ctx && currentLab.canvas) {
        currentLab.ctx.clearRect(0, 0, currentLab.canvas.width, currentLab.canvas.height);
      }
    }

    function loadTask() {
      if (currentLab) cleanupLab(currentLab);

      if (currentTaskIdx >= examTasks.length) {
        endExam(false, 'All tasks completed');
        return;
      }
      const t = examTasks[currentTaskIdx];
      hideAllTaskUIs();
      $('examTaskDesc').innerHTML = `<strong>${t.title}</strong> (${t.points} pts)`;
      $('examStatusMsg').textContent = 'Complete the task, then click SUBMIT TASK.';
      $('examStatusMsg').className = 'exam-status-area';
      $('examFeedback').textContent = 'Read the instructions.';
      $('examResultMiniBody').textContent = 'No submission yet.';
      $('examResultMiniBody').className = 'exam-result-mini-body';

      switch (t.type) {
        case 'crimp': loadCrimpTask(t); break;
        case 'topology': loadTopoTask(t); break;
        case 'subnet': loadSubnetTask(t); break;
        case 'firewall': loadFirewallTask(t); break;
        case 'ping': loadPingTask(t); break;
        case 'loadbalancer': loadLBATask(t); break;
      }
      updateExamHeader();
    }

    function loadCrimpTask(t) {
      $('examCrimpUI').style.display = 'flex';

      const primaryStd = t.crimpStandard || 'B';
      const otherStd = t.cableType === 'crossover'
        ? (primaryStd === 'A' ? 'B' : 'A')
        : primaryStd;

      currentCrimpStandard = primaryStd;

      const cableLabel = t.cableType === 'crossover' ? 'Crossover' : 'Straight-Through';

      $('examTaskDesc').innerHTML =
        `<strong>${t.title}</strong> (${t.points} pts)<br>
        <span style="font-size:0.85rem; color:#8ba9bc;">
          Cable: <strong>${cableLabel}</strong> ·
          This end: <strong>T568${primaryStd}</strong>
          ${t.cableType === 'crossover' ? ` · Other end: <strong>T568${otherStd}</strong>` : ''}
        </span>`;

      slotWires = new Array(8).fill(null);
      selectedSlot = -1;
      selectedPaletteIdx = 0;
      buildExamPins();
      buildExamWireSlots();
      buildExamPalette(primaryStd);
    }

    function buildExamPalette(std) {
      std = std || 'B';
      const wp = $('examWirePalette');
      wp.innerHTML = '';
      const seq = WIRE_STANDARDS[std] || WIRE_STANDARDS.B;
      shuffledPalette = shuffleArray(seq);

      shuffledPalette.forEach((wire, idx) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        if (wire.stripe) {
          item.style.background = wire.base;
          const stripe = document.createElement('div');
          stripe.className = 'stripe-overlay';
          item.appendChild(stripe);
        } else item.style.background = wire.hex;
        item.title = wire.name;
        if (idx === selectedPaletteIdx) item.classList.add('active-palette');
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedPaletteIdx = idx;
          document.querySelectorAll('#examWirePalette .palette-item').forEach((el, i) => {
            el.classList.toggle('active-palette', i === idx);
          });
          if (selectedSlot !== -1) placeExamWire(selectedSlot, idx);
        });
        wp.appendChild(item);
      });
    }

    function buildExamPins() {
      const pc = $('examPinContainer');
      pc.innerHTML = '';
      for (let i = 1; i <= 8; i++) {
        const pin = document.createElement('div');
        pin.className = 'pin';
        pin.textContent = i;
        pin.addEventListener('click', () => selectExamSlot(i - 1));
        pc.appendChild(pin);
      }
    }

    function buildExamWireSlots() {
      const wc = $('examWireSlotContainer');
      wc.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const row = document.createElement('div');
        row.className = 'wire-row';
        const label = document.createElement('span');
        label.className = 'slot-label';
        label.textContent = `${i + 1}`;
        const indicator = document.createElement('div');
        indicator.className = 'wire-indicator';
        indicator.dataset.slotIndex = i;
        const fill = document.createElement('div');
        fill.className = 'wire-fill';
        indicator.appendChild(fill);
        const wireLabel = document.createElement('span');
        wireLabel.className = 'wire-label';
        indicator.appendChild(wireLabel);
        indicator.addEventListener('click', (e) => { e.stopPropagation(); selectExamSlot(i); });
        row.appendChild(label);
        row.appendChild(indicator);
        wc.appendChild(row);
      }
    }

    function updateExamSlotVisual(slotIdx) {
      const ind = document.querySelector(`#examWireSlotContainer .wire-indicator[data-slot-index="${slotIdx}"]`);
      if (!ind) return;
      const fill = ind.querySelector('.wire-fill');
      const lbl = ind.querySelector('.wire-label');
      const wire = slotWires[slotIdx];
      if (wire) {
        ind.classList.add('filled');
        if (wire.stripe) {
          fill.style.background = `repeating-linear-gradient(90deg, ${wire.base} 0px, ${wire.base} 4px, ${wire.second} 4px, ${wire.second} 8px)`;
        } else fill.style.background = wire.hex;
        fill.style.width = '100%';
        lbl.textContent = wire.name;
      } else {
        ind.classList.remove('filled');
        fill.style.width = '0%';
        lbl.textContent = '';
      }
    }

    function selectExamSlot(slotIdx) {
      selectedSlot = slotIdx;
      document.querySelectorAll('#examWireSlotContainer .wire-indicator').forEach((el, idx) => {
        if (idx === slotIdx) {
          el.style.outline = '3px solid #ffb347';
          el.style.outlineOffset = '2px';
        } else el.style.outline = 'none';
      });
      document.querySelectorAll('#examPinContainer .pin').forEach((pin, idx) => {
        pin.classList.toggle('selected', idx === slotIdx);
      });
    }

    function placeExamWire(slotIdx, paletteIdx) {
      const wt = shuffledPalette[paletteIdx];
      if (!wt) return;
      slotWires[slotIdx] = { ...wt };
      updateExamSlotVisual(slotIdx);
    }

    function submitCrimpTask(t) {
      if (slotWires.some((w) => w === null)) {
        $('examStatusMsg').textContent = '⚠️ Some slots are empty.';
        $('examStatusMsg').className = 'exam-status-area error';
        return;
      }

      const primaryStd = t.crimpStandard || 'B';
      const expectedSeq = WIRE_STANDARDS[primaryStd] || WIRE_STANDARDS.B;

      let correct = 0;
      for (let i = 0; i < 8; i++) {
        if (slotWires[i] && slotWires[i].name === expectedSeq[i].name) correct++;
      }

      const allCorrect = correct === 8;
      const earned = allCorrect ? t.points : Math.round((correct / 8) * t.points);
      const stdLabel = `T568${primaryStd}`;

      finishTask(
        t,
        earned,
        allCorrect,
        allCorrect ? `Perfect! Wired correctly as ${stdLabel}` : `${correct}/8 wires match ${stdLabel}`
      );
    }

    function loadTopoTask(t) {
      $('examLabUI').style.display = 'flex';
      $('examTaskDesc').innerHTML =
        `<strong>${t.title}</strong> (${t.points} pts)<br>
        <span style="font-size:0.85rem; color:#8ba9bc;">
          Target: <strong>${t.targetTopology.toUpperCase()}</strong> · Min devices: <strong>${t.minDevices}</strong>
        </span>`;
      currentLab = createLab('examTopoCanvas', ['pc', 'switch', 'router', 'server', 'firewall', 'lb', 'internet']);
      labAttach(currentLab);
      setupExamLabToolbar(currentLab.deviceTypes);
      setTimeout(() => labDraw(currentLab), 50);
    }

    function submitTopoTask(t) {
      if (!currentLab) return;
      const detected = detectLabTopology(currentLab);
      const target = t.targetTopology;
      const deviceCount = currentLab.devices.length;
      const topologyMatch = detected === target;
      const enoughDevices = deviceCount >= t.minDevices;
      const passed = topologyMatch && enoughDevices;
      const earned = passed ? t.points : 0;
      let msg = passed ? `Perfect! Detected: ${detected.toUpperCase()}` : `Detected: ${detected.toUpperCase()}`;
      if (!topologyMatch && !passed) msg += ` — Expected: ${target.toUpperCase()}`;
      if (!enoughDevices && !passed) msg += ` · Need at least ${t.minDevices} devices`;
      finishTask(t, earned, passed, msg);
    }

    function loadSubnetTask(t) {
      $('examSubnetUI').style.display = 'flex';
      $('examTaskDesc').innerHTML = `<strong>${t.title}</strong> (${t.points} pts)`;
      $('examSubnetGiven').textContent = `IP: ${t.ip} / ${t.cidr}`;
      $('examSubnetNetwork').value = '';
      $('examSubnetBroadcast').value = '';
      $('examSubnetMask').value = '';
      $('examSubnetFirst').value = '';
      $('examSubnetLast').value = '';
    }

    function submitSubnetTask(t) {
      const ipLong = ipToLong(t.ip);
      if (ipLong === null) { $('examStatusMsg').textContent = 'Task error.'; return; }
      const maskLong = (~0 << (32 - t.cidr)) >>> 0;
      const netLong = (ipLong & maskLong) >>> 0;
      const bcLong = (netLong | (~maskLong >>> 0)) >>> 0;
      const expectedNet = longToIp(netLong);
      const expectedBc = longToIp(bcLong);
      const expectedMask = longToIp(maskLong);
      const expectedFirst = longToIp(netLong + 1);
      const expectedLast = longToIp(bcLong - 1);
      const gotNet = $('examSubnetNetwork').value.trim();
      const gotBc = $('examSubnetBroadcast').value.trim();
      const gotMask = $('examSubnetMask').value.trim();
      const gotFirst = $('examSubnetFirst').value.trim();
      const gotLast = $('examSubnetLast').value.trim();
      let correct = 0;
      if (gotNet === expectedNet) correct++;
      if (gotBc === expectedBc) correct++;
      if (gotMask === expectedMask) correct++;
      if (gotFirst === expectedFirst && gotLast === expectedLast) correct++;
      const allCorrect = correct === 4;
      const earned = Math.round((correct / 4) * t.points);
      finishTask(t, earned, allCorrect, allCorrect ? 'All subnet details correct!' : `${correct}/4 fields correct`);
    }

    function loadFirewallTask(t) {
      $('examLabUI').style.display = 'flex';
      $('examFirewallUI').style.display = 'flex';
      $('examTaskDesc').innerHTML =
        `<strong>${t.title}</strong> (${t.points} pts)<br>
        <span style="font-size:0.85rem; color:#8ba9bc;">
          Required rule: <strong>${t.requiredRule}</strong>
        </span>`;
      currentLab = createLab('examTopoCanvas', ['pc', 'firewall', 'server', 'internet']);
      labAttach(currentLab);
      setupExamLabToolbar(currentLab.deviceTypes);
      setTimeout(() => labDraw(currentLab), 50);
    }

    function submitFirewallTask(t) {
      if (!currentLab) return;
      const hasFw = currentLab.devices.some((d) => d.type === 'firewall');
      const selected = $('examFwRule').value;
      const ruleMatch = selected === t.requiredRule;
      const passed = hasFw && ruleMatch;
      const earned = passed ? t.points : 0;
      let msg = '';
      if (!hasFw) msg = 'No Firewall device placed.';
      else if (!ruleMatch) msg = `Rule: ${selected || 'none'} — Expected: ${t.requiredRule}`;
      else msg = 'Firewall configured correctly!';
      finishTask(t, earned, passed, msg);
    }

    function loadPingTask(t) {
      $('examLabUI').style.display = 'flex';
      $('examPingUI').style.display = 'flex';
      $('examTaskDesc').innerHTML =
        `<strong>${t.title}</strong> (${t.points} pts)<br>
        <span style="font-size:0.85rem; color:#8ba9bc;">Target: <strong>${t.target}</strong></span>`;
      $('examPingTarget').textContent = `Target: ${t.target}`;
      $('examPingOutput').textContent = 'Build the topology, then click Run Ping.';
      $('examPingOutput').className = 'pt-result';
      currentLab = createLab('examTopoCanvas', ['pc', 'router', 'internet']);
      labAttach(currentLab);
      setupExamLabToolbar(currentLab.deviceTypes);

      $('examPingRunBtn').onclick = () => {
        const net = currentLab.devices.find((d) => d.type === 'internet');
        const rtr = currentLab.devices.find((d) => d.type === 'router');
        if (!net || !rtr) {
          $('examPingOutput').innerHTML = '❌ Need Internet device and Router.';
          $('examPingOutput').className = 'pt-result error';
          return;
        }
        const adj = {};
        currentLab.devices.forEach((d) => adj[d.id] = []);
        currentLab.connections.forEach((c) => {
          if (adj[c.from]) adj[c.from].push(c.to);
          if (adj[c.to]) adj[c.to].push(c.from);
        });
        function hasPath(s, e) {
          const v = new Set([s]), q = [s];
          while (q.length) {
            const n = q.shift();
            if (n === e) return true;
            (adj[n] || []).forEach((nb) => { if (!v.has(nb)) { v.add(nb); q.push(nb); } });
          }
          return false;
        }
        if (!hasPath(net.id, rtr.id)) {
          $('examPingOutput').innerHTML = '❌ Internet not connected to Router.';
          $('examPingOutput').className = 'pt-result error';
          return;
        }
        const lats = [12, 15, 18, 22, 25, 28, 31, 35];
        let out = `📶 PING ${t.target}<br><div style="font-family:monospace; font-size:0.75rem;">`;
        for (let i = 0; i < 4; i++) out += `Reply: time=${lats[Math.floor(Math.random() * lats.length)]}ms<br>`;
        out += `</div><br>✅ Connectivity confirmed.`;
        $('examPingOutput').innerHTML = out;
        $('examPingOutput').className = 'pt-result ok';
      };
      setTimeout(() => labDraw(currentLab), 50);
    }

    function submitPingTask(t) {
      const output = $('examPingOutput');
      const success = output.classList.contains('ok');
      const earned = success ? t.points : 0;
      finishTask(t, earned, success, success ? 'Ping successful!' : 'Ping not successful');
    }

    function loadLBATask(t) {
      $('examLabUI').style.display = 'flex';
      $('examLBUI').style.display = 'flex';
      $('examTaskDesc').innerHTML =
        `<strong>${t.title}</strong> (${t.points} pts)<br>
        <span style="font-size:0.85rem; color:#8ba9bc;">
          Algorithm: <strong>${t.requiredAlgo}</strong> · Min servers: <strong>${t.minServers}</strong>
        </span>`;
      currentLab = createLab('examTopoCanvas', ['pc', 'lb', 'server']);
      labAttach(currentLab);
      setupExamLabToolbar(currentLab.deviceTypes);

      $('examLBRunBtn').onclick = () => {
        const lb = currentLab.devices.find((d) => d.type === 'lb');
        if (!lb) {
          $('examLBOutput').innerHTML = '❌ No Load Balancer placed.';
          $('examLBOutput').className = 'pt-result error';
          return;
        }
        const servers = currentLab.devices.filter((d) => d.type === 'server');
        const connected = servers.filter((s) =>
          currentLab.connections.some((c) =>
            (c.from === lb.id && c.to === s.id) || (c.from === s.id && c.to === lb.id)));
        if (connected.length === 0) {
          $('examLBOutput').innerHTML = '❌ No servers connected to LB.';
          $('examLBOutput').className = 'pt-result error';
          return;
        }
        $('examLBOutput').innerHTML = `✅ LB connected to ${connected.length} server(s).`;
        $('examLBOutput').className = 'pt-result ok';
      };
      setTimeout(() => labDraw(currentLab), 50);
    }

    function submitLBATask(t) {
      if (!currentLab) return;
      const lb = currentLab.devices.find((d) => d.type === 'lb');
      const servers = currentLab.devices.filter((d) => d.type === 'server');
      const connectedServers = lb ? servers.filter((s) =>
        currentLab.connections.some((c) =>
          (c.from === lb.id && c.to === s.id) || (c.from === s.id && c.to === lb.id))) : [];
      const selectedAlgo = $('examLBRule').value;
      const hasLB = !!lb;
      const enoughServers = connectedServers.length >= t.minServers;
      const algoMatch = selectedAlgo === t.requiredAlgo;
      const passed = hasLB && enoughServers && algoMatch;
      const earned = passed ? t.points : 0;
      let msg = '';
      if (!hasLB) msg = 'No Load Balancer placed.';
      else if (!enoughServers) msg = `Only ${connectedServers.length} server(s) connected (need ${t.minServers}).`;
      else if (!algoMatch) msg = `Algorithm: ${selectedAlgo || 'none'} — Expected: ${t.requiredAlgo}`;
      else msg = 'Load balancer configured correctly!';
      finishTask(t, earned, passed, msg);
    }

    function finishTask(t, earned, passed, msg) {
      pointsEarned += earned;
      taskResults.push({
        id: t.id, type: t.type, title: t.title,
        points: t.points, earned, passed, message: msg
      });
      $('examResultMiniBody').textContent = passed
        ? `✅ ${t.title} (+${earned} pts)`
        : `❌ ${t.title} (${earned}/${t.points} pts)`;
      $('examResultMiniBody').className = 'exam-result-mini-body ' + (passed ? 'pass' : 'fail');
      $('examStatusMsg').textContent = msg;
      $('examStatusMsg').className = 'exam-status-area ' + (passed ? 'ok' : 'error');
      $('examFeedback').textContent = passed ? 'Task complete!' : 'Task recorded.';
      updateExamHeader();

      setTimeout(() => {
        currentTaskIdx++;
        if (currentTaskIdx >= examTasks.length) {
          endExam(false, 'All tasks completed');
        } else {
          loadTask();
        }
      }, 2200);
    }

    $('examSubmitBtn').addEventListener('click', () => {
      if (!examActive || examFinished) return;
      const t = examTasks[currentTaskIdx];
      if (!t) return;
      switch (t.type) {
        case 'crimp': submitCrimpTask(t); break;
        case 'topology': submitTopoTask(t); break;
        case 'subnet': submitSubnetTask(t); break;
        case 'firewall': submitFirewallTask(t); break;
        case 'ping': submitPingTask(t); break;
        case 'loadbalancer': submitLBATask(t); break;
      }
    });

    async function endExam(autoSubmit, reason) {
      if (examFinished) return;
      examFinished = true;
      examActive = false;
      if (timerInterval) clearInterval(timerInterval);
      deactivateAntiCheat();
      exitFullscreen();

      $('examActiveScreen').style.display = 'none';
      $('examResultsScreen').style.display = 'flex';

      const finalScore = pointsTotal > 0 ? Math.round((pointsEarned / pointsTotal) * 100) : 0;
      const passed = finalScore >= passThreshold;

      let grade = 'F';
      if (finalScore === 100) grade = 'A+';
      else if (finalScore >= 90) grade = 'A';
      else if (finalScore >= 80) grade = 'B';
      else if (finalScore >= 70) grade = 'C';
      else if (finalScore >= 60) grade = 'D';

      $('examResultIcon').textContent = passed ? '🏆' : '📉';
      $('examResultTitle').textContent = passed ? 'EXAM PASSED' : 'EXAM FAILED';
      $('examResultTitle').style.color = passed ? '#6ee7a0' : '#ff8888';
      $('examResultSub').textContent = autoSubmit
        ? `Auto-submitted: ${reason}`
        : `Completed ${taskResults.length} of ${examTasks.length} tasks.`;
      $('finalScore').textContent = finalScore + '%';
      $('finalCorrect').textContent = `${pointsEarned}/${pointsTotal}`;
      $('finalGrade').textContent = grade;
      $('finalViolations').textContent = violations;

      $('examResultDetails').innerHTML = '';
      taskResults.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'exam-detail-row ' + (r.passed ? 'pass' : 'fail');
        row.innerHTML = `
          <span class="edr-num">${i + 1}</span>
          <span class="edr-info">
            <strong>${r.title}</strong><br>
            <span style="font-size:0.75rem; color:#8ba9bc;">${r.type} · ${r.message}</span>
          </span>
          <span class="edr-score">${r.earned}/${r.points}</span>
        `;
        $('examResultDetails').appendChild(row);
      });

      const examRecord = {
        studentName, studentId,
        score: finalScore, passed, violations,
        timestamp: new Date().toISOString(),
        challenges: taskResults.length, grade,
        details: {
          tasks: taskResults.map((r) => ({
            title: r.title, type: r.type,
            earned: r.earned, points: r.points, passed: r.passed
          })),
          autoSubmit, reason
        }
      };

      const history = JSON.parse(localStorage.getItem('exam_history') || '[]');
      history.push(examRecord);
      localStorage.setItem('exam_history', JSON.stringify(history));

      const sheetCfg = getSheetConfig();
      const syncStatus = $('sheetSyncStatus');
      if (sheetCfg.url && sheetCfg.autoSync) {
        syncStatus.textContent = '☁️ Syncing to cloud...';
        syncStatus.className = 'pt-result';
        const result = await submitToGoogleSheet(examRecord);
        if (result.success) {
          syncStatus.textContent = '✅ Record saved to cloud.' + (result.row ? ` (row ${result.row})` : '');
          syncStatus.className = 'pt-result ok';
        } else {
          syncStatus.textContent = '⚠️ Local save OK, cloud failed: ' + result.error;
          syncStatus.className = 'pt-result warn';
        }
      } else {
        syncStatus.textContent = 'ℹ️ Cloud sync not configured. Saved locally.';
        syncStatus.className = 'pt-result warn';
      }
    }

    $('examExitBtn').addEventListener('click', () => {
      examFinished = false;
      examActive = false;
      window.refreshExamScreen();
    });

    $('examRetakeBtn').addEventListener('click', () => {
      $('retakeModal').style.display = 'flex';
      $('retakeTokenInput').value = '';
      $('retakeError').textContent = '';
      $('retakeError').style.color = '#ff8888';
      setTimeout(() => $('retakeTokenInput').focus(), 100);
    });

    $('retakeCancelBtn').addEventListener('click', () => {
      $('retakeModal').style.display = 'none';
    });

    $('retakeModal').addEventListener('click', (e) => {
      if (e.target === $('retakeModal')) $('retakeModal').style.display = 'none';
    });

    $('retakeTokenInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') $('retakeConfirmBtn').click();
    });

    $('retakeConfirmBtn').addEventListener('click', () => {
      const entered = ($('retakeTokenInput').value || '').trim().toUpperCase();
      if (!entered) {
        $('retakeError').textContent = '⚠️ Please enter the token.';
        $('retakeError').style.color = '#ff8888';
        return;
      }
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('retake_token') || 'null'); } catch (e) { stored = null; }
      if (!stored || !stored.token) {
        $('retakeError').textContent = '❌ No retake token issued. Ask your instructor.';
        $('retakeError').style.color = '#ff8888';
        return;
      }
      if (stored.expires && stored.expires < Date.now()) {
        $('retakeError').textContent = '❌ Token has expired. Ask for a new one.';
        $('retakeError').style.color = '#ff8888';
        return;
      }
      if (entered !== stored.token.toUpperCase()) {
        $('retakeError').textContent = '❌ Invalid token. Check and try again.';
        $('retakeError').style.color = '#ff8888';
        $('retakeTokenInput').value = '';
        $('retakeTokenInput').focus();
        return;
      }
      $('retakeError').textContent = '✅ Token accepted! Starting new attempt...';
      $('retakeError').style.color = '#6ee7a0';

      setTimeout(() => {
        localStorage.removeItem('retake_token');
        $('retakeModal').style.display = 'none';
        $('retakeError').style.color = '#ff8888';
        examFinished = false;
        examActive = false;
        window.refreshExamScreen();
      }, 700);
    });

    window.examActive = function () { return examActive; };

    setTimeout(() => window.refreshExamScreen(), 100);
  })();

  // ==================== NETWORK LAB (Practice) ====================
  (function () {
    const canvas = $('topoCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const CW = 900, CH = 500;
    canvas.width = CW;
    canvas.height = CH;

    const DEVICE_STYLE = {
      pc: { icon: '💻', color: '#5a6a7a', label: 'PC' },
      server: { icon: '🖥️', color: '#7a6a9a', label: 'Server' },
      switch: { icon: '🔀', color: '#4a9b8e', label: 'Switch' },
      router: { icon: '📡', color: '#3a7ca5', label: 'Router' },
      firewall: { icon: '🛡️', color: '#a55a4a', label: 'Firewall' },
      lb: { icon: '⚖️', color: '#8a6a3a', label: 'LoadBalancer' },
      internet: { icon: '🌍', color: '#2a6a9a', label: 'Internet' }
    };

    let devices = [], connections = [];
    let currentTool = 'connect';
    let selectedDeviceType = 'pc';
    let selectedDeviceId = null, connectSourceId = null, hoverDeviceId = null;
    let dragDeviceId = null, dragOffsetX = 0, dragOffsetY = 0;
    let nextId = 1;

    function detectTopology() {
      const n = devices.length, e = connections.length;
      if (n === 0) return { name: 'None', icon: '❓', desc: 'Place devices', detected: false };
      if (n === 1) return { name: 'Single Node', icon: '📍', desc: 'One device', detected: false };
      if (e === 0) return { name: 'Isolated', icon: '🔘', desc: `${n} unconnected`, detected: false };
      const degrees = {};
      devices.forEach((d) => degrees[d.id] = 0);
      connections.forEach((c) => {
        if (degrees[c.from] !== undefined) degrees[c.from]++;
        if (degrees[c.to] !== undefined) degrees[c.to]++;
      });
      const dv = Object.values(degrees);
      const adj = {};
      devices.forEach((d) => adj[d.id] = []);
      connections.forEach((c) => {
        if (adj[c.from]) adj[c.from].push(c.to);
        if (adj[c.to]) adj[c.to].push(c.from);
      });
      function bfs(s) {
        const v = new Set([s]), q = [s];
        while (q.length) {
          const node = q.shift();
          (adj[node] || []).forEach((nb) => { if (!v.has(nb)) { v.add(nb); q.push(nb); } });
        }
        return v;
      }
      const visited = bfs(devices[0].id);
      const connected = visited.size === n;
      if (n === 2 && e === 1) return { name: 'Point-to-Point', icon: '↔️', desc: 'Direct', detected: true };
      const starHub = dv.filter((d) => d > 2).length === 1;
      const allLeaf = dv.filter((d) => d === 1).length === n - 1;
      if (connected && starHub && allLeaf && n >= 3) return { name: 'Star', icon: '⭐', desc: `Hub + ${n - 1}`, detected: true };
      const maxEdges = (n * (n - 1)) / 2;
      if (e === maxEdges && n >= 3) return { name: 'Full Mesh', icon: '🕸️', desc: `${e} links`, detected: true };
      const allDeg2 = dv.every((d) => d === 2);
      if (connected && allDeg2 && n >= 3 && e === n) return { name: 'Ring', icon: '⭕', desc: `${n} nodes`, detected: true };
      const deg1 = dv.filter((d) => d === 1).length;
      const deg2 = dv.filter((d) => d === 2).length;
      if (connected && deg1 === 2 && deg2 === n - 2 && e === n - 1 && n >= 3) return { name: 'Bus', icon: '📏', desc: `${n} chained`, detected: true };
      if (connected && e === n - 1) return { name: 'Tree', icon: '🌳', desc: `${n} nodes`, detected: true };
      if (!connected) return { name: 'Disconnected', icon: '⚠️', desc: `${n} devices`, detected: false };
      return { name: 'Hybrid', icon: '🔀', desc: `${n} nodes, ${e} links`, detected: true };
    }

    function updateTopologyBadge() {
      const r = detectTopology();
      $('topoTypeIcon').textContent = r.icon;
      $('topoTypeName').textContent = r.name;
      $('topoTypeDesc').textContent = r.desc;
      $('topoTypeBadge').classList.toggle('detected', r.detected);
    }

    function draw() {
      ctx.clearRect(0, 0, CW, CH);
      ctx.strokeStyle = '#1a2c38';
      ctx.lineWidth = 1;
      for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
      for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }

      connections.forEach((conn) => {
        const a = devices.find((d) => d.id === conn.from);
        const b = devices.find((d) => d.id === conn.to);
        if (!a || !b) return;
        const isNet = a.type === 'internet' || b.type === 'internet';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isNet ? '#2a9ad0' : '#4a8aaa';
        ctx.lineWidth = 4;
        ctx.stroke();
      });

      if (currentTool === 'connect' && connectSourceId !== null) {
        const s = devices.find((d) => d.id === connectSourceId);
        if (s) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffb347';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      devices.forEach((d) => {
        const style = DEVICE_STYLE[d.type];
        if (!style) return;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 28, 0, Math.PI * 2);
        ctx.fillStyle = style.color;
        ctx.fill();
        ctx.strokeStyle = d.id === selectedDeviceId ? '#88c0d0' : '#2a4a5a';
        ctx.lineWidth = d.id === selectedDeviceId ? 4 : 2;
        ctx.stroke();
        ctx.font = '24px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(style.icon, d.x, d.y - 2);
        ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#d0e8f5';
        ctx.fillText(d.label, d.x, d.y + 42);
      });
    }

    function deviceAt(x, y) {
      for (let i = devices.length - 1; i >= 0; i--) {
        const d = devices[i];
        if (Math.hypot(x - d.x, y - d.y) < 34) return d;
      }
      return null;
    }

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
      const hit = deviceAt(x, y);

      if (currentTool === 'delete') {
        if (hit) {
          devices = devices.filter((d) => d.id !== hit.id);
          connections = connections.filter((c) => c.from !== hit.id && c.to !== hit.id);
          if (selectedDeviceId === hit.id) selectedDeviceId = null;
          if (connectSourceId === hit.id) connectSourceId = null;
          updateAll();
        }
        return;
      }
      if (currentTool === 'connect') {
        if (hit) {
          if (connectSourceId === null) {
            connectSourceId = hit.id;
            selectedDeviceId = hit.id;
          } else if (connectSourceId === hit.id) {
            connectSourceId = null;
          } else {
            const exists = connections.some((c) =>
              (c.from === connectSourceId && c.to === hit.id) ||
              (c.from === hit.id && c.to === connectSourceId));
            if (!exists) connections.push({ from: connectSourceId, to: hit.id });
            connectSourceId = null;
            selectedDeviceId = hit.id;
          }
          updateAll();
          return;
        } else {
          if (connectSourceId !== null) { connectSourceId = null; draw(); return; }
          const style = DEVICE_STYLE[selectedDeviceType];
          const newId = nextId++;
          devices.push({
            id: newId, type: selectedDeviceType,
            x: Math.min(Math.max(x, 40), CW - 40),
            y: Math.min(Math.max(y, 40), CH - 40),
            label: `${style.label}${newId}`
          });
          selectedDeviceId = newId;
          updateAll();
          return;
        }
      }
      if (currentTool === 'select') {
        if (hit) {
          dragDeviceId = hit.id;
          dragOffsetX = x - hit.x;
          dragOffsetY = y - hit.y;
          selectedDeviceId = hit.id;
          updateAll();
        } else {
          selectedDeviceId = null;
          updateAll();
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * sx, y = (e.clientY - rect.top) * sy;
      if (dragDeviceId) {
        const d = devices.find((dev) => dev.id === dragDeviceId);
        if (d) {
          d.x = Math.min(Math.max(x - dragOffsetX, 40), CW - 40);
          d.y = Math.min(Math.max(y - dragOffsetY, 40), CH - 40);
          draw();
        }
        return;
      }
      const hit = deviceAt(x, y);
      const nh = hit ? hit.id : null;
      if (nh !== hoverDeviceId) { hoverDeviceId = nh; draw(); }
    });

    canvas.addEventListener('mouseup', () => { if (dragDeviceId) { dragDeviceId = null; draw(); } });
    canvas.addEventListener('mouseleave', () => {
      hoverDeviceId = null; dragDeviceId = null; draw();
    });

    function updateAll() {
      const d = devices.find((dev) => dev.id === selectedDeviceId);
      if (!d) $('deviceInfo').innerHTML = 'No device selected.';
      else {
        const s = DEVICE_STYLE[d.type];
        const cc = connections.filter((c) => c.from === d.id || c.to === d.id).length;
        $('deviceInfo').innerHTML = `<strong>${s.icon} ${d.label}</strong><br>Type: ${s.label}<br>Connections: ${cc}`;
      }
      $('deviceSummary').innerHTML = '';
      devices.forEach((d) => {
        const tag = document.createElement('span');
        tag.className = 'device-tag';
        tag.textContent = `${DEVICE_STYLE[d.type].icon} ${d.label}`;
        if (d.id === selectedDeviceId) tag.classList.add('selected');
        tag.addEventListener('click', () => { selectedDeviceId = d.id; updateAll(); });
        $('deviceSummary').appendChild(tag);
      });
      updateTopologyBadge();
      draw();
    }

    function setTool(tool) {
      currentTool = tool;
      ['toolSelect', 'toolConnect', 'toolDelete'].forEach((id) => {
        const el = $(id);
        if (el) el.classList.toggle('selected', id === 'tool' + tool.charAt(0).toUpperCase() + tool.slice(1));
      });
      if (tool !== 'connect') connectSourceId = null;
      draw();
    }
    $('toolSelect').addEventListener('click', () => setTool('select'));
    $('toolConnect').addEventListener('click', () => setTool('connect'));
    $('toolDelete').addEventListener('click', () => setTool('delete'));
    $('toolCancel').addEventListener('click', () => {
      connectSourceId = null; selectedDeviceId = null;
      updateAll();
    });

    document.querySelectorAll('.pt-device-btn[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pt-device-btn[data-type]').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedDeviceType = btn.dataset.type;
      });
    });

    $('btnClearTopo').addEventListener('click', () => {
      if (confirm('Clear all?')) {
        devices = []; connections = []; selectedDeviceId = null;
        connectSourceId = null; nextId = 1;
        updateAll();
      }
    });

    $('btnShowConfigs').addEventListener('click', () => {
      if (devices.length === 0) { alert('No devices.'); return; }
      let txt = '📋 Devices:\n\n';
      devices.forEach((d) => {
        const cc = connections.filter((c) => c.from === d.id || c.to === d.id).length;
        txt += `${DEVICE_STYLE[d.type].icon} ${d.label} — ${cc} connections\n`;
      });
      alert(txt);
    });

    $('btnPingRun').addEventListener('click', () => {
      const net = devices.find((d) => d.type === 'internet');
      const rtr = devices.find((d) => d.type === 'router');
      if (!net) { $('pingResult').innerHTML = '❌ No Internet device.'; $('pingResult').className = 'pt-result error'; return; }
      if (!rtr) { $('pingResult').innerHTML = '❌ No Router.'; $('pingResult').className = 'pt-result error'; return; }
      const adj = {};
      devices.forEach((d) => adj[d.id] = []);
      connections.forEach((c) => { if (adj[c.from]) adj[c.from].push(c.to); if (adj[c.to]) adj[c.to].push(c.from); });
      function hasPath(s, e) {
        const v = new Set([s]), q = [s];
        while (q.length) {
          const n = q.shift();
          if (n === e) return true;
          (adj[n] || []).forEach((nb) => { if (!v.has(nb)) { v.add(nb); q.push(nb); } });
        }
        return false;
      }
      if (!hasPath(net.id, rtr.id)) {
        $('pingResult').innerHTML = '❌ Internet not connected to Router.';
        $('pingResult').className = 'pt-result error';
        return;
      }
      const target = $('pingTarget').value;
      const lats = [12, 15, 18, 22, 25, 28, 31, 35];
      let out = `📶 PING ${target}<br><div style="font-family:monospace; font-size:0.75rem;">`;
      for (let i = 0; i < 4; i++) out += `Reply: time=${lats[Math.floor(Math.random() * lats.length)]}ms<br>`;
      out += `</div><br>✅ Confirmed.`;
      $('pingResult').innerHTML = out;
      $('pingResult').className = 'pt-result ok';
    });

    $('btnRunLB').addEventListener('click', () => {
      const lb = devices.find((d) => d.type === 'lb');
      if (!lb) { $('lbResult').textContent = '❌ No LB.'; $('lbResult').className = 'pt-result error'; $('lbStats').innerHTML = ''; return; }
      const servers = devices.filter((d) => d.type === 'server').filter((s) =>
        connections.some((c) => (c.from === lb.id && c.to === s.id) || (c.from === s.id && c.to === lb.id)));
      if (servers.length === 0) { $('lbResult').textContent = '❌ No servers connected.'; $('lbResult').className = 'pt-result error'; $('lbStats').innerHTML = ''; return; }
      const totalReq = parseInt($('lbRequests').value) || 1000;
      const algo = $('lbAlgorithm').value;
      let dist = [];
      if (algo === 'round-robin' || algo === 'least-connections') {
        const base = Math.floor(totalReq / servers.length);
        const rem = totalReq % servers.length;
        dist = servers.map((s, i) => ({ server: s, count: base + (i < rem ? 1 : 0) }));
      } else {
        const w = servers.map((_, i) => servers.length - i);
        const tw = w.reduce((a, b) => a + b, 0);
        dist = servers.map((s, i) => ({ server: s, count: Math.round(totalReq * w[i] / tw) }));
      }
      $('lbStats').innerHTML = '';
      dist.forEach((d) => {
        const pct = Math.round((d.count / totalReq) * 100);
        const div = document.createElement('div');
        div.className = 'lb-server';
        const lc = pct > 50 ? 'high' : pct > 35 ? 'med' : '';
        div.innerHTML = `<span class="lb-name">🖥️ ${d.server.label}</span><span class="lb-load ${lc}">${d.count} req (${pct}%)</span>`;
        $('lbStats').appendChild(div);
      });
      $('lbResult').textContent = `✅ ${algo.replace('-', ' ')} — ${totalReq} req / ${servers.length} servers.`;
      $('lbResult').className = 'pt-result ok';
    });

    function addLog(msg, type = 'info') {
      const t = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-entry ' + type;
      div.innerHTML = `<span class="log-time">${t}</span> ${msg}`;
      $('securityLog').insertBefore(div, $('securityLog').firstChild);
      while ($('securityLog').children.length > 20) $('securityLog').removeChild($('securityLog').lastChild);
    }

    $('btnApplyFw').addEventListener('click', () => {
      const fw = devices.find((d) => d.type === 'firewall');
      const rule = $('fwRule').value;
      if (!fw) { $('securityResult').textContent = '❌ No Firewall.'; $('securityResult').className = 'pt-result error'; return; }
      const rn = { 'allow-all': 'Allow All', 'deny-all': 'Deny All', 'allow-http': 'HTTP', 'allow-https': 'HTTPS', 'allow-ssh': 'SSH' };
      $('securityResult').innerHTML = `🔒 <strong>${fw.label}</strong>: <strong>${rn[rule]}</strong>`;
      $('securityResult').className = 'pt-result ok';
      addLog(`Firewall: ${rn[rule]}`, 'success');
    });

    $('btnScan').addEventListener('click', () => {
      const fw = devices.find((d) => d.type === 'firewall');
      const srv = devices.filter((d) => d.type === 'server');
      const net = devices.find((d) => d.type === 'internet');
      let issues = 0;
      let rep = '🔍 Scan:<br>';
      if (!fw) { rep += '⚠️ No firewall.<br>'; issues++; }
      else { rep += `✅ Firewall: ${fw.label}<br>`; }
      if (srv.length > 0 && !fw) { rep += `⚠️ ${srv.length} exposed server(s).<br>`; issues++; }
      if (net && !fw) { rep += '⚠️ Internet without firewall.<br>'; issues++; }
      if (issues === 0) { rep += '<br>✅ Secure.'; $('securityResult').className = 'pt-result ok'; }
      else { rep += `<br>❌ ${issues} issue(s).`; $('securityResult').className = 'pt-result warn'; }
      $('securityResult').innerHTML = rep;
    });

    function ipToLong(ip) {
      const p = ip.split('.').map(Number);
      if (p.length !== 4 || p.some((x) => isNaN(x) || x < 0 || x > 255)) return null;
      return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
    }
    function longToIp(l) { return [(l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255].join('.'); }

    $('calcSubnetBtn').addEventListener('click', () => {
      const ip = $('ipInput').value.trim();
      const cidr = parseInt($('cidrSelect').value);
      const il = ipToLong(ip);
      if (il === null) { $('subnetResult').textContent = '❌ Invalid IP.'; $('subnetResult').className = 'pt-result error'; return; }
      const ml = (~0 << (32 - cidr)) >>> 0;
      const nl = (il & ml) >>> 0;
      const bl = (nl | (~ml >>> 0)) >>> 0;
      $('subnetResult').innerHTML = `
        <strong>Network:</strong> ${longToIp(nl)}<br>
        <strong>Broadcast:</strong> ${longToIp(bl)}<br>
        <strong>Mask:</strong> ${longToIp(ml)}<br>
        <strong>Host Range:</strong> ${longToIp(nl + 1)} – ${longToIp(bl - 1)}
      `;
      $('subnetResult').className = 'pt-result ok';
    });

    window.redrawTopo = draw;
    updateAll();
    addLog('Network Lab ready.', 'info');
  })();
};
