'use strict';

// ── AUTH ──────────────────────────────────────────────────────────────────
const TEACHERS_KEY = 'abs_teachers';
const SESSION_KEY  = 'abs_session';

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function getTeachers() {
  try { return JSON.parse(localStorage.getItem(TEACHERS_KEY) || 'null') || null; }
  catch { return null; }
}
function saveTeachers(t) { localStorage.setItem(TEACHERS_KEY, JSON.stringify(t)); }

async function ensureDefaultTeacher() {
  if (!getTeachers()) {
    const hash = await sha256('admin123');
    saveTeachers([{ username: 'admin', hash, isAdmin: true }]);
  }
}
async function doLogin(username, password) {
  const teachers = getTeachers() || [];
  const hash = await sha256(password);
  const found = teachers.find(t => t.username === username && t.hash === hash);
  if (!found) throw new Error('Username atau password salah');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username, loginAt: Date.now() }));
  return found;
}
function getSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}
function showLoginScreen(show=true) {
  const ls   = document.getElementById('login-screen');
  const nav  = document.getElementById('nav');
  const main = document.getElementById('main');
  ls.classList.toggle('open', show);
  if (nav)  nav.style.display  = show ? 'none' : '';
  if (main) main.style.display = show ? 'none' : '';
}
function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  showLoginScreen(true);
  document.getElementById('l-user').value = '';
  document.getElementById('l-pass').value = '';
  document.getElementById('login-error').textContent = '';
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  btn.textContent = 'Memverifikasi…'; btn.disabled = true;
  errEl.textContent = '';
  try {
    await doLogin(
      document.getElementById('l-user').value.trim(),
      document.getElementById('l-pass').value
    );
    showLoginScreen(false);
    loadLocal(); populateSelects(); renderGhStatus(); renderAll();
    document.getElementById('print-date').value = today();
  } catch(err) {
    errEl.textContent = '❌ ' + err.message;
  } finally {
    btn.textContent = 'Masuk →'; btn.disabled = false;
  }
});

// Teacher management
function renderTeacherList() {
  const el = document.getElementById('teacher-list');
  if (!el) return;
  const teachers = getTeachers() || [];
  if (!teachers.length) { el.innerHTML = '<p style="color:var(--text3);font-size:.82rem">Belum ada akun guru.</p>'; return; }
  el.innerHTML = teachers.map(t => `
    <div class="teacher-row">
      <div><div class="tr-name">👤 ${t.username}</div><div class="tr-role">${t.isAdmin?'Admin':'Guru'}</div></div>
      ${t.isAdmin?'':` <button class="teacher-del" onclick="removeTeacher('${t.username}')">✕</button>`}
    </div>`).join('');
}
function removeTeacher(username) {
  const cur = getSession();
  if (cur?.username === username) { showToast('Tidak bisa hapus akun yang sedang login'); return; }
  saveTeachers((getTeachers()||[]).filter(t => t.username !== username));
  renderTeacherList();
  showToast(`🗑 Akun ${username} dihapus`);
}
document.getElementById('add-teacher-btn').addEventListener('click', async () => {
  const u = document.getElementById('new-user').value.trim();
  const p = document.getElementById('new-pass').value.trim();
  if (!u || !p) { showToast('Isi username dan password'); return; }
  const teachers = getTeachers() || [];
  if (teachers.find(t => t.username === u)) { showToast('Username sudah dipakai'); return; }
  const hash = await sha256(p);
  teachers.push({ username: u, hash, isAdmin: false });
  saveTeachers(teachers);
  document.getElementById('new-user').value = '';
  document.getElementById('new-pass').value = '';
  renderTeacherList();
  showToast(`✅ Akun guru ${u} berhasil dibuat`);
});


// ── CONSTANTS ─────────────────────────────────────────────────────────────
const CLASSES = [
  ...Array.from({length:12},(_,i)=>`X-${i+1}`),
  ...Array.from({length:12},(_,i)=>`XI-${i+1}`),
  ...Array.from({length:12},(_,i)=>`XII-${i+1}`)
];
const STATUSES = ['Sakit','Izin','Alpa','Terlambat'];
const GIST_FILENAME = 'absensi_data.json';

// ── STATE ─────────────────────────────────────────────────────────────────
let records = [];
let students = {}; // { 'X-1': [{name, nis}], ... }
let deletingId = null;
let selectedStatus = 'Sakit';

function loadLocal() {
  try { records = JSON.parse(localStorage.getItem('abs_records') || '[]'); }
  catch { records = []; }
  try { students = JSON.parse(localStorage.getItem('abs_students') || '{}'); }
  catch { students = {}; }
}
function saveLocal() {
  localStorage.setItem('abs_records', JSON.stringify(records));
}
function saveStudents() {
  localStorage.setItem('abs_students', JSON.stringify(students));
}
function getPAT()    { return localStorage.getItem('abs_pat') || ''; }
function getGistId() { return localStorage.getItem('abs_gist') || ''; }

// ── HELPERS ───────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function today() { return new Date().toISOString().split('T')[0]; }
function nowTime() { return new Date().toTimeString().slice(0,5); }
function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}
function showToast(msg, dur=3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}
function badgeHtml(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}
function getStudentsForClass(cls) {
  return students[cls] || [];
}

// ── GITHUB GIST ───────────────────────────────────────────────────────────
async function gistRequest(method, path, body=null) {
  const pat = getPAT();
  if (!pat) throw new Error('NO_PAT');
  const opts = {
    method,
    headers: { 'Authorization': `token ${pat}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.github.com${path}`, opts);
  if (res.status === 401) throw new Error('INVALID_PAT');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json();
}

async function syncToGist() {
  const pat = getPAT();
  if (!pat) { showToast('⚙️ Atur GitHub PAT dulu di Pengaturan'); return; }
  const content = JSON.stringify({ records, students, updatedAt: new Date().toISOString() }, null, 2);
  const body = { files: { [GIST_FILENAME]: { content } } };
  try {
    let gistId = getGistId();
    let data;
    if (gistId) {
      data = await gistRequest('PATCH', `/gists/${gistId}`, body);
    } else {
      body.description = 'AbsenSI — Data Absensi Sekolah';
      body.public = false;
      data = await gistRequest('POST', '/gists', body);
      localStorage.setItem('abs_gist', data.id);
    }
    setGhConnected(true);
    showToast('☁️ Data berhasil disimpan ke GitHub Gist!');
    renderGhStatus();
  } catch(e) {
    setGhConnected(false);
    showToast('❌ Gagal sync: ' + e.message, 4000);
  }
}

async function loadFromGist() {
  const gistId = getGistId();
  if (!gistId) { showToast('⚙️ Masukkan Gist ID di Pengaturan'); return; }
  try {
    const data = await gistRequest('GET', `/gists/${gistId}`);
    const raw = data.files[GIST_FILENAME]?.content;
    if (!raw) throw new Error('File tidak ditemukan di Gist');
    const parsed = JSON.parse(raw);
    records = parsed.records || [];
    if (parsed.students) students = parsed.students;
    saveLocal();
    saveStudents();
    setGhConnected(true);
    showToast(`✅ ${records.length} record dimuat dari GitHub Gist!`);
    renderAll();
  } catch(e) {
    setGhConnected(false);
    showToast('❌ Gagal load: ' + e.message, 4000);
  }
}

function setGhConnected(ok) {
  const el = document.getElementById('gh-indicator');
  if (ok) el.classList.add('connected'); else el.classList.remove('connected');
}

function renderGhStatus() {
  const gistId = getGistId();
  const statusEls = document.querySelectorAll('.gh-status');
  statusEls.forEach(el => {
    if (gistId) {
      el.className = 'gh-status ok';
      el.innerHTML = `✅ Terhubung ke Gist <code>${gistId.slice(0,8)}…</code>`;
    } else {
      el.className = 'gh-status err';
      el.innerHTML = `❌ Belum terhubung ke GitHub Gist`;
    }
  });
  setGhConnected(!!gistId);
}

// ── CRUD ──────────────────────────────────────────────────────────────────
function addRecord(rec) {
  records.unshift({ ...rec, id: uid(), createdAt: Date.now() });
  saveLocal();
}
function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  saveLocal();
}
function getFiltered({ search='', cls='', status='', dateFrom='', dateTo='' }={}) {
  return records.filter(r => {
    if (cls && r.class !== cls) return false;
    if (status && r.status !== status) return false;
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.nis.includes(q)) return false;
    }
    return true;
  });
}

// ── DUPLICATE CHECK ────────────────────────────────────────────────────────
function isDuplicate(cls, nis, date) {
  return records.some(r => r.class === cls && r.nis === nis && r.date === date);
}

// ── RENDER DASHBOARD ──────────────────────────────────────────────────────
function renderDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent =
    now.toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  const td = today();
  const curMonth = td.slice(0,7);
  document.getElementById('s-today').textContent  = records.filter(r=>r.date===td).length;
  document.getElementById('s-month').textContent  = records.filter(r=>r.date.startsWith(curMonth)).length;
  document.getElementById('s-total').textContent  = records.length;

  // Class grids
  function buildGrid(el, prefix) {
    el.innerHTML = '';
    CLASSES.filter(c=>c.startsWith(prefix+'-')).forEach(cls => {
      const cnt = records.filter(r=>r.class===cls&&r.date===td).length;
      const btn = document.createElement('button');
      btn.className = 'class-btn' + (cnt>0?' has-absent':'');
      btn.innerHTML = `${cls}<span class="class-count">${cnt>0?cnt+' absen':''}</span>`;
      btn.onclick = () => openAddModal(cls);
      el.appendChild(btn);
    });
  }
  buildGrid(document.getElementById('grid-x'),   'X');
  buildGrid(document.getElementById('grid-xi'),  'XI');
  buildGrid(document.getElementById('grid-xii'), 'XII');

  // Today's list
  const todayRecs = records.filter(r=>r.date===td).slice(0,20);
  const list = document.getElementById('today-list');
  if (!todayRecs.length) {
    list.innerHTML = '<div class="empty-state"><div>🎉</div><h3>Tidak ada absensi hari ini</h3><p>Semua siswa hadir atau belum ada yang dicatat.</p></div>';
    return;
  }
  list.innerHTML = todayRecs.map(r=>`
    <div class="today-row">
      <span class="tr-class">${r.class}</span>
      <div><div class="tr-name">${r.name}</div><div class="tr-nis">NIS: ${r.nis}</div></div>
      <div class="tr-right">
        ${badgeHtml(r.status)}
        <span class="tr-time">⏰ ${r.time}</span>
        <button class="del-btn" onclick="confirmDelete('${r.id}')">🗑</button>
      </div>
    </div>`).join('');
}

// ── RENDER RECORDS TABLE ──────────────────────────────────────────────────
function renderRecords() {
  const search  = document.getElementById('f-search').value.trim();
  const cls     = document.getElementById('f-class-filter').value;
  const status  = document.getElementById('f-status-filter').value;
  const dtFrom  = document.getElementById('f-date-from').value;
  const dtTo    = document.getElementById('f-date-to').value;

  const filtered = getFiltered({search,cls,status,dateFrom:dtFrom,dateTo:dtTo});
  document.getElementById('records-count').textContent =
    `Menampilkan ${filtered.length} dari ${records.length} record`;

  const tbody = document.getElementById('records-body');
  const empty = document.getElementById('records-empty');
  if (!filtered.length) {
    tbody.innerHTML = ''; empty.style.display=''; return;
  }
  empty.style.display='none';
  tbody.innerHTML = filtered.map(r=>`
    <tr>
      <td><strong>${r.class}</strong></td>
      <td>${r.name}</td>
      <td style="color:var(--text2)">${r.nis}</td>
      <td>${fmtDate(r.date)}</td>
      <td>${r.time}</td>
      <td>${badgeHtml(r.status)}</td>
      <td style="color:var(--text2);font-size:.8rem">${r.note||'—'}</td>
      <td><button class="del-btn" onclick="confirmDelete('${r.id}')">🗑</button></td>
    </tr>`).join('');
}

function renderAll() { renderDashboard(); renderRecords(); }

// ── POPULATE SELECTS ──────────────────────────────────────────────────────
function populateSelects() {
  const selects = ['f-class','f-class-filter','exp-class','print-class',
                   'bulk-class','mgmt-class','recap-class'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    Array.from(el.options).forEach(o=>{ if(o.value) el.removeChild(o); });
    CLASSES.forEach(c => {
      const o = document.createElement('option');
      o.value = o.textContent = c;
      el.appendChild(o);
    });
    if (cur) el.value = cur;
  });
}

// ── ADD MODAL (single) ────────────────────────────────────────────────────
function openAddModal(preClass='') {
  document.getElementById('f-class').value  = preClass;
  document.getElementById('f-name').value   = '';
  document.getElementById('f-nis').value    = '';
  document.getElementById('f-date').value   = today();
  document.getElementById('f-time').value   = nowTime();
  document.getElementById('f-note').value   = '';
  document.getElementById('duplicate-warning').style.display = 'none';
  selectedStatus = 'Sakit';
  document.querySelectorAll('.spill').forEach(p=>{
    p.classList.toggle('active', p.dataset.status===selectedStatus);
  });
  document.getElementById('add-modal-class-label').textContent =
    preClass ? `Kelas ${preClass}` : 'Lengkapi data absensi';
  closeSuggestions();
  document.getElementById('add-modal').classList.add('open');
}
function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open');
  closeSuggestions();
}

// Autocomplete logic
function closeSuggestions() {
  document.getElementById('name-suggestions').classList.remove('open');
}

document.getElementById('f-name').addEventListener('input', function() {
  const cls = document.getElementById('f-class').value;
  const query = this.value.trim().toLowerCase();
  const dropdown = document.getElementById('name-suggestions');
  checkDuplicate();

  if (!cls || !query || query.length < 1) { closeSuggestions(); return; }
  const stu = getStudentsForClass(cls);
  const matches = stu.filter(s => s.name.toLowerCase().includes(query));
  if (!matches.length) { closeSuggestions(); return; }

  dropdown.innerHTML = matches.slice(0,8).map(s =>
    `<div class="suggestion-item" data-name="${s.name}" data-nis="${s.nis}">
      <span>${s.name}</span><span class="sug-nis">${s.nis}</span>
    </div>`
  ).join('');
  dropdown.classList.add('open');
});

document.getElementById('name-suggestions').addEventListener('click', function(e) {
  const item = e.target.closest('.suggestion-item');
  if (!item) return;
  document.getElementById('f-name').value = item.dataset.name;
  document.getElementById('f-nis').value  = item.dataset.nis;
  closeSuggestions();
  checkDuplicate();
});

document.getElementById('f-class').addEventListener('change', function() {
  document.getElementById('f-name').value = '';
  document.getElementById('f-nis').value  = '';
  closeSuggestions();
  checkDuplicate();
});

document.addEventListener('click', function(e) {
  if (!e.target.closest('#f-name') && !e.target.closest('#name-suggestions')) {
    closeSuggestions();
  }
});

function checkDuplicate() {
  const cls  = document.getElementById('f-class').value;
  const nis  = document.getElementById('f-nis').value.trim();
  const date = document.getElementById('f-date').value;
  const warn = document.getElementById('duplicate-warning');
  if (cls && nis && date && isDuplicate(cls, nis, date)) {
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}
document.getElementById('f-nis').addEventListener('input', checkDuplicate);
document.getElementById('f-date').addEventListener('change', checkDuplicate);

document.getElementById('add-form').addEventListener('submit', e=>{
  e.preventDefault();
  const cls  = document.getElementById('f-class').value;
  const name = document.getElementById('f-name').value.trim();
  const nis  = document.getElementById('f-nis').value.trim();
  const date = document.getElementById('f-date').value;

  if (!/^[A-Za-z\u00C0-\u024F\s'.]+$/.test(name)) {
    showToast('⚠️ Nama hanya boleh berisi huruf dan spasi'); return;
  }
  if (!/^[0-9]{4,15}$/.test(nis)) {
    showToast('⚠️ NIS hanya boleh berisi angka (4-15 digit)'); return;
  }
  if (!cls) { showToast('Pilih kelas terlebih dahulu'); return; }

  if (isDuplicate(cls, nis, date)) {
    if (!confirm(`Siswa dengan NIS ${nis} sudah tercatat absen hari ini di kelas ${cls}. Tetap simpan?`)) return;
  }

  // Auto-add to student list if not exists
  autoAddStudent(cls, name, nis);

  addRecord({
    class: cls, name, nis,
    date,
    time:   document.getElementById('f-time').value,
    status: selectedStatus,
    note:   document.getElementById('f-note').value.trim()
  });
  closeAddModal();
  renderAll();
  showToast(`✅ Absensi ${name} berhasil dicatat!`);
  if (getPAT() && getGistId()) syncToGist();
});

function autoAddStudent(cls, name, nis) {
  if (!students[cls]) students[cls] = [];
  const exists = students[cls].find(s => s.nis === nis);
  if (!exists) {
    students[cls].push({ name, nis });
    saveStudents();
  }
}

// Status pill selection
document.getElementById('status-pills').addEventListener('click', e=>{
  const pill = e.target.closest('.spill');
  if (!pill) return;
  selectedStatus = pill.dataset.status;
  document.querySelectorAll('.spill').forEach(p=>p.classList.toggle('active',p===pill));
});

// ── BULK MODAL ────────────────────────────────────────────────────────────
let bulkChecked = {}; // { nis: statusString }

function openBulkModal(preClass='') {
  document.getElementById('bulk-date').value = today();
  document.getElementById('bulk-time').value = nowTime();
  if (preClass) document.getElementById('bulk-class').value = preClass;
  bulkChecked = {};
  renderBulkStudentList();
  document.getElementById('bulk-modal').classList.add('open');
}
function closeBulkModal() {
  document.getElementById('bulk-modal').classList.remove('open');
}

document.getElementById('bulk-class').addEventListener('change', () => {
  bulkChecked = {};
  renderBulkStudentList();
});

function renderBulkStudentList() {
  const cls = document.getElementById('bulk-class').value;
  const list = document.getElementById('bulk-student-list');
  const countLabel = document.getElementById('bulk-count-label');

  if (!cls) {
    list.innerHTML = '<div class="bulk-empty">Pilih kelas terlebih dahulu untuk melihat daftar siswa.</div>';
    countLabel.textContent = '';
    return;
  }

  const stu = getStudentsForClass(cls);
  if (!stu.length) {
    list.innerHTML = `<div class="bulk-empty">Belum ada daftar siswa untuk kelas ${cls}.<br>
      <small>Tambahkan siswa di menu 👥 Kelola Siswa atau catat absen satu per satu terlebih dahulu.</small></div>`;
    countLabel.textContent = '';
    return;
  }

  const checkedCount = Object.keys(bulkChecked).length;
  countLabel.textContent = checkedCount > 0 ? `${checkedCount} siswa dipilih` : '';

  list.innerHTML = `
    <div class="bulk-select-all" id="bulk-select-all-btn">
      <div class="bulk-checkbox" id="select-all-check">${checkedCount === stu.length ? '✓' : ''}</div>
      <span>${checkedCount === stu.length ? 'Batalkan semua' : 'Pilih semua'}</span>
    </div>
    ${stu.map(s => {
      const isChecked = !!bulkChecked[s.nis];
      const curStatus = bulkChecked[s.nis] || 'Alpa';
      return `
        <div class="bulk-student-row${isChecked?' checked':''}" data-nis="${s.nis}" data-name="${s.name}">
          <div class="bulk-checkbox">${isChecked?'✓':''}</div>
          <div style="flex:1">
            <div class="bulk-stu-name">${s.name}</div>
            <div class="bulk-stu-nis">NIS: ${s.nis}</div>
          </div>
          ${isChecked ? `
          <div class="bulk-stu-status" onclick="event.stopPropagation()">
            ${STATUSES.map(st => `
              <button class="bulk-status-pill${curStatus===st?' active':''}"
                data-nis="${s.nis}" data-status="${st}">${st}</button>
            `).join('')}
          </div>` : ''}
        </div>`;
    }).join('')}
  `;

  // Toggle row check
  list.querySelectorAll('.bulk-student-row').forEach(row => {
    row.addEventListener('click', () => {
      const nis  = row.dataset.nis;
      const name = row.dataset.name;
      if (bulkChecked[nis]) {
        delete bulkChecked[nis];
      } else {
        bulkChecked[nis] = 'Alpa';
      }
      renderBulkStudentList();
    });
  });

  // Status pill inside row
  list.querySelectorAll('.bulk-status-pill').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      bulkChecked[btn.dataset.nis] = btn.dataset.status;
      renderBulkStudentList();
    });
  });

  // Select all
  const selectAllBtn = document.getElementById('bulk-select-all-btn');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      if (Object.keys(bulkChecked).length === stu.length) {
        bulkChecked = {};
      } else {
        stu.forEach(s => { bulkChecked[s.nis] = bulkChecked[s.nis] || 'Alpa'; });
      }
      renderBulkStudentList();
    });
  }
}

document.getElementById('bulk-save').addEventListener('click', () => {
  const cls  = document.getElementById('bulk-class').value;
  const date = document.getElementById('bulk-date').value;
  const time = document.getElementById('bulk-time').value;

  if (!cls) { showToast('Pilih kelas terlebih dahulu'); return; }
  if (!date) { showToast('Pilih tanggal'); return; }

  const selected = Object.entries(bulkChecked);
  if (!selected.length) { showToast('Centang siswa yang tidak hadir terlebih dahulu'); return; }

  const stu = getStudentsForClass(cls);
  let saved = 0, skipped = 0;

  selected.forEach(([nis, status]) => {
    if (isDuplicate(cls, nis, date)) { skipped++; return; }
    const student = stu.find(s => s.nis === nis);
    if (!student) return;
    addRecord({ class: cls, name: student.name, nis, date, time, status, note: '' });
    saved++;
  });

  closeBulkModal();
  renderAll();
  let msg = `✅ ${saved} absensi berhasil disimpan!`;
  if (skipped > 0) msg += ` (${skipped} dilewati karena duplikat)`;
  showToast(msg, 4000);
  if (getPAT() && getGistId()) syncToGist();
});

document.getElementById('bulk-close').onclick  = closeBulkModal;
document.getElementById('bulk-cancel').onclick  = closeBulkModal;
document.getElementById('bulk-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeBulkModal(); });

// ── STUDENT MANAGEMENT MODAL ──────────────────────────────────────────────
function openStudentsModal() {
  populateSelects();
  document.getElementById('mgmt-class').value = '';
  renderStudentMgmtList();
  document.getElementById('add-student-row').style.display = 'none';
  document.getElementById('students-modal').classList.add('open');
}
function closeStudentsModal() {
  document.getElementById('students-modal').classList.remove('open');
}

document.getElementById('mgmt-class').addEventListener('change', () => {
  renderStudentMgmtList();
  const cls = document.getElementById('mgmt-class').value;
  document.getElementById('add-student-row').style.display = cls ? 'block' : 'none';
});

function renderStudentMgmtList() {
  const cls = document.getElementById('mgmt-class').value;
  const container = document.getElementById('student-mgmt-list');
  if (!cls) {
    container.innerHTML = '<div class="no-students">Pilih kelas untuk melihat daftar siswa.</div>';
    return;
  }
  const stu = getStudentsForClass(cls);
  if (!stu.length) {
    container.innerHTML = `<div class="no-students">Belum ada siswa di kelas ${cls}.</div>`;
    return;
  }
  container.innerHTML = stu.map((s, i) => `
    <div class="student-mgmt-item">
      <div>
        <div class="sm-name">${i+1}. ${s.name}</div>
        <div class="sm-nis">NIS: ${s.nis}</div>
      </div>
      <button class="student-del-btn" onclick="removeStudent('${cls}','${s.nis}')">🗑 Hapus</button>
    </div>
  `).join('');
}

window.removeStudent = function(cls, nis) {
  if (!students[cls]) return;
  students[cls] = students[cls].filter(s => s.nis !== nis);
  saveStudents();
  renderStudentMgmtList();
  showToast('🗑 Siswa dihapus dari daftar');
};

document.getElementById('save-new-student').addEventListener('click', () => {
  const cls  = document.getElementById('mgmt-class').value;
  const name = document.getElementById('new-student-name').value.trim();
  const nis  = document.getElementById('new-student-nis').value.trim();
  if (!cls) { showToast('Pilih kelas dulu'); return; }
  if (!name || !nis) { showToast('Isi nama dan NIS siswa'); return; }
  if (!/^[0-9]{4,15}$/.test(nis)) { showToast('NIS hanya boleh angka (4-15 digit)'); return; }
  if (!students[cls]) students[cls] = [];
  if (students[cls].find(s => s.nis === nis)) { showToast('NIS sudah terdaftar di kelas ini'); return; }
  students[cls].push({ name, nis });
  saveStudents();
  document.getElementById('new-student-name').value = '';
  document.getElementById('new-student-nis').value  = '';
  renderStudentMgmtList();
  showToast(`✅ Siswa ${name} ditambahkan ke kelas ${cls}`);
});

// CSV Import
document.getElementById('import-students-btn').addEventListener('click', () => {
  document.getElementById('import-csv-input').click();
});
document.getElementById('import-csv-input').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;
  const cls = document.getElementById('mgmt-class').value;
  if (!cls) { showToast('Pilih kelas dulu sebelum import'); this.value=''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').map(l=>l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    if (!students[cls]) students[cls] = [];
    lines.forEach((line, idx) => {
      if (idx === 0 && (line.toLowerCase().includes('nama') || line.toLowerCase().includes('name'))) return; // skip header
      const parts = line.split(/[,;|\t]/);
      if (parts.length < 2) return;
      const name = parts[0].replace(/"/g,'').trim();
      const nis  = parts[1].replace(/"/g,'').trim();
      if (!name || !nis) return;
      if (students[cls].find(s => s.nis === nis)) { skipped++; return; }
      students[cls].push({ name, nis });
      added++;
    });
    saveStudents();
    renderStudentMgmtList();
    showToast(`✅ Import selesai: ${added} siswa ditambahkan, ${skipped} dilewati`, 4000);
  };
  reader.readAsText(file);
  this.value = '';
});

document.getElementById('students-close').onclick  = closeStudentsModal;
document.getElementById('students-cancel').onclick  = closeStudentsModal;
document.getElementById('students-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeStudentsModal(); });

// ── WEEKLY RECAP MODAL ────────────────────────────────────────────────────
function getWeekRange(weekStr) {
  // weekStr: "2025-W19"
  if (!weekStr) return { from: '', to: '' };
  const [year, week] = weekStr.split('-W').map(Number);
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const mondayOfW1 = new Date(jan4);
  mondayOfW1.setDate(jan4.getDate() - dayOfWeek + 1);
  const monday = new Date(mondayOfW1);
  monday.setDate(monday.getDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  return { from: fmt(monday), to: fmt(sunday) };
}

function openRecapModal() {
  // Set current week
  const now = new Date();
  const y = now.getFullYear();
  const startOfYear = new Date(y, 0, 1);
  const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  document.getElementById('recap-week').value = `${y}-W${String(weekNum).padStart(2,'0')}`;
  document.getElementById('recap-class').value = '';
  populateSelects();
  renderRecapContent();
  document.getElementById('recap-modal').classList.add('open');
}
function closeRecapModal() {
  document.getElementById('recap-modal').classList.remove('open');
}

function renderRecapContent() {
  const weekStr = document.getElementById('recap-week').value;
  const cls     = document.getElementById('recap-class').value;
  const content = document.getElementById('recap-content');

  if (!weekStr) { content.innerHTML = '<p style="color:var(--text3);text-align:center;padding:20px">Pilih minggu terlebih dahulu.</p>'; return; }

  const { from, to } = getWeekRange(weekStr);
  const filtered = getFiltered({ cls, dateFrom: from, dateTo: to });

  if (!filtered.length) {
    content.innerHTML = `<p style="color:var(--text3);text-align:center;padding:20px">Tidak ada absensi pada minggu ${from} s/d ${to}.</p>`;
    return;
  }

  const byStatus = { Sakit: 0, Izin: 0, Alpa: 0, Terlambat: 0 };
  filtered.forEach(r => { if (byStatus[r.status] !== undefined) byStatus[r.status]++; });

  content.innerHTML = `
    <div style="font-size:.8rem;color:var(--text2);margin-bottom:12px">
      📅 Periode: ${fmtDate(from)} — ${fmtDate(to)}
      ${cls ? ` · Kelas ${cls}` : ' · Semua Kelas'}
    </div>
    <div class="recap-summary">
      <div class="recap-stat"><div class="recap-stat-n">${filtered.length}</div><div class="recap-stat-l">Total</div></div>
      <div class="recap-stat" style="color:#b36b00"><div class="recap-stat-n">${byStatus.Sakit}</div><div class="recap-stat-l">Sakit</div></div>
      <div class="recap-stat" style="color:var(--purple)"><div class="recap-stat-n">${byStatus.Izin}</div><div class="recap-stat-l">Izin</div></div>
      <div class="recap-stat" style="color:var(--red)"><div class="recap-stat-n">${byStatus.Alpa}</div><div class="recap-stat-l">Alpa</div></div>
    </div>
    <div class="recap-table-wrap">
      <table class="recap-table">
        <thead><tr><th>Kelas</th><th>Nama</th><th>NIS</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>
          ${filtered.map(r=>`
            <tr>
              <td><strong>${r.class}</strong></td>
              <td>${r.name}</td>
              <td style="color:var(--text3)">${r.nis}</td>
              <td>${fmtDate(r.date)}</td>
              <td>${r.time}</td>
              <td>${badgeHtml(r.status)}</td>
              <td style="color:var(--text3);font-size:.78rem">${r.note||'—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

document.getElementById('recap-week').addEventListener('change', renderRecapContent);
document.getElementById('recap-class').addEventListener('change', renderRecapContent);

document.getElementById('recap-export-csv').addEventListener('click', () => {
  const weekStr = document.getElementById('recap-week').value;
  const cls     = document.getElementById('recap-class').value;
  if (!weekStr) { showToast('Pilih minggu terlebih dahulu'); return; }
  const { from, to } = getWeekRange(weekStr);
  const rows = getFiltered({ cls, dateFrom: from, dateTo: to });
  if (!rows.length) { showToast('Tidak ada data untuk diexport'); return; }
  const headers = ['Kelas','Nama','NIS','Tanggal','Jam','Status','Keterangan'];
  const csv = [headers, ...rows.map(r=>[
    r.class, r.name, r.nis, r.date, r.time, r.status, r.note||''
  ])].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download = `rekap_${weekStr}_${cls||'semua'}.csv`;
  a.click();
  showToast('📊 Rekap CSV berhasil didownload!');
});

document.getElementById('recap-print').addEventListener('click', () => {
  const weekStr = document.getElementById('recap-week').value;
  const cls     = document.getElementById('recap-class').value;
  const { from, to } = getWeekRange(weekStr);
  const rows = getFiltered({ cls, dateFrom: from, dateTo: to });
  const title = `Rekap Mingguan${cls?' — '+cls:''} (${fmtDate(from)} s/d ${fmtDate(to)})`;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${title}</title>
    <style>body{font-family:'Inter',sans-serif;padding:30px;font-size:13px}
    h1{font-size:18px;margin-bottom:4px}p{color:#666;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}
    th{background:#f5f5f7;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;color:#86868b;border-bottom:2px solid #e0e0e0}
    td{padding:8px 10px;border-bottom:1px solid #f0f0f0}
    </style></head><body>
    <h1>${title}</h1>
    <p>Dicetak: ${new Date().toLocaleString('id-ID')} · Total: ${rows.length} record</p>
    <table><thead><tr><th>Kelas</th><th>Nama</th><th>NIS</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Keterangan</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${r.class}</td><td>${r.name}</td><td>${r.nis}</td><td>${fmtDate(r.date)}</td><td>${r.time}</td><td>${r.status}</td><td>${r.note||'—'}</td></tr>`).join('')}</tbody>
    </table></body></html>`);
  win.document.close();
  win.print();
});

document.getElementById('recap-close').onclick  = closeRecapModal;
document.getElementById('recap-cancel').onclick  = closeRecapModal;
document.getElementById('recap-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeRecapModal(); });

// Export view rekap shortcut
document.getElementById('do-recap').addEventListener('click', () => {
  const wk = document.getElementById('export-week-input').value;
  if (wk) document.getElementById('recap-week').value = wk;
  openRecapModal();
});

// ── DELETE ────────────────────────────────────────────────────────────────
function confirmDelete(id) {
  deletingId = id;
  document.getElementById('del-modal').classList.add('open');
}
window.confirmDelete = confirmDelete;

document.getElementById('del-confirm').onclick = () => {
  if (!deletingId) return;
  deleteRecord(deletingId);
  deletingId = null;
  document.getElementById('del-modal').classList.remove('open');
  renderAll();
  showToast('🗑 Data dihapus');
  if (getPAT() && getGistId()) syncToGist();
};
document.getElementById('del-cancel').onclick = () => {
  deletingId = null;
  document.getElementById('del-modal').classList.remove('open');
};

// ── SETTINGS MODAL ────────────────────────────────────────────────────────
function openCfgModal() {
  document.getElementById('cfg-pat').value  = getPAT();
  document.getElementById('cfg-gist').value = getGistId();
  document.getElementById('cfg-modal').classList.add('open');
  renderGhStatus();
  renderTeacherList();
}
function closeCfgModal() { document.getElementById('cfg-modal').classList.remove('open'); }

document.getElementById('cfg-save').onclick = async () => {
  const pat  = document.getElementById('cfg-pat').value.trim();
  const gist = document.getElementById('cfg-gist').value.trim();
  if (!pat) { showToast('Masukkan GitHub PAT'); return; }
  const btn = document.getElementById('cfg-save');
  btn.textContent = '⏳ Memverifikasi…'; btn.disabled = true;
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${pat}` }
    });
    if (!res.ok) throw new Error('PAT tidak valid');
    const user = await res.json();
    localStorage.setItem('abs_pat', pat);
    if (gist) localStorage.setItem('abs_gist', gist);
    closeCfgModal();
    renderGhStatus();
    showToast(`✅ Terhubung sebagai @${user.login}!`);
  } catch(e) {
    document.getElementById('gh-status').className = 'gh-status err';
    document.getElementById('gh-status').textContent = '❌ ' + e.message;
  } finally {
    btn.textContent = '🔗 Hubungkan GitHub'; btn.disabled = false;
  }
};
document.getElementById('cfg-cancel').onclick = closeCfgModal;
document.getElementById('cfg-close').onclick  = closeCfgModal;
document.getElementById('cfg-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeCfgModal(); });

// ── VIEW SWITCHING ────────────────────────────────────────────────────────
function switchView(name) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  document.getElementById('tab-'+name)?.classList.add('active');
  if (name==='records') renderRecords();
}
document.querySelectorAll('.ntab').forEach(tab=>{
  tab.addEventListener('click', ()=>switchView(tab.dataset.view));
});

// ── EXPORT ────────────────────────────────────────────────────────────────
document.getElementById('do-csv').onclick = () => {
  const cls = document.getElementById('exp-class').value;
  const rows = getFiltered({cls});
  if (!rows.length) { showToast('Tidak ada data untuk diexport'); return; }
  const headers = ['Kelas','Nama','NIS','Tanggal','Jam','Status','Keterangan'];
  const csv = [headers, ...rows.map(r=>[
    r.class, r.name, r.nis, r.date, r.time, r.status, r.note||''
  ])].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
  a.download = `absensi_${cls||'semua'}_${today()}.csv`;
  a.click();
  showToast('📊 CSV berhasil didownload!');
};

document.getElementById('do-print').onclick = () => {
  const cls  = document.getElementById('print-class').value;
  const date = document.getElementById('print-date').value;
  const rows = getFiltered({cls, dateFrom:date, dateTo:date});
  const title = `Rekap Absensi${cls?' — '+cls:''}${date?' ('+fmtDate(date)+')':''}`;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${title}</title>
    <style>body{font-family:'Inter',sans-serif;padding:30px;font-size:13px}
    h1{font-size:18px;margin-bottom:4px}p{color:#666;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}
    th{background:#f5f5f7;padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#86868b;border-bottom:2px solid #e0e0e0}
    td{padding:8px 10px;border-bottom:1px solid #f0f0f0}
    </style></head><body>
    <h1>${title}</h1>
    <p>Dicetak: ${new Date().toLocaleString('id-ID')}</p>
    <table><thead><tr><th>Kelas</th><th>Nama</th><th>NIS</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Keterangan</th></tr></thead>
    <tbody>${rows.map(r=>`<tr><td>${r.class}</td><td>${r.name}</td><td>${r.nis}</td><td>${fmtDate(r.date)}</td><td>${r.time}</td><td>${r.status}</td><td>${r.note||'—'}</td></tr>`).join('')}</tbody>
    </table></body></html>`);
  win.document.close();
  win.print();
};

document.getElementById('do-sync').onclick = () => syncToGist();
document.getElementById('do-load').onclick = () => loadFromGist();

// ── FILTERS (live) ────────────────────────────────────────────────────────
['f-search','f-class-filter','f-status-filter','f-date-from','f-date-to'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input', renderRecords);
  document.getElementById(id)?.addEventListener('change', renderRecords);
});
document.getElementById('f-clear').onclick = () => {
  ['f-search','f-date-from','f-date-to'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  ['f-class-filter','f-status-filter'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  renderRecords();
};

// ── WIRE BUTTONS ─────────────────────────────────────────────────────────
document.getElementById('nav-add-btn').onclick   = () => openAddModal();
document.getElementById('nav-bulk-btn').onclick  = () => openBulkModal();
document.getElementById('dash-add-btn').onclick  = () => openAddModal();
document.getElementById('dash-bulk-btn').onclick = () => openBulkModal();
document.getElementById('rec-add-btn').onclick   = () => openAddModal();
document.getElementById('rec-bulk-btn').onclick  = () => openBulkModal();
document.getElementById('add-close').onclick     = closeAddModal;
document.getElementById('add-cancel').onclick    = closeAddModal;
document.getElementById('add-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) closeAddModal(); });
document.getElementById('open-cfg').onclick      = openCfgModal;
document.getElementById('open-students').onclick = openStudentsModal;
document.getElementById('open-recap').onclick    = openRecapModal;
document.getElementById('logout-btn').onclick    = logout;

// ── NAV SCROLL ────────────────────────────────────────────────────────────
window.addEventListener('scroll', ()=>{
  document.getElementById('nav').style.boxShadow =
    scrollY > 5 ? '0 2px 20px rgba(0,0,0,.12)' : '';
});

// ── INIT ──────────────────────────────────────────────────────────────────
(async function init() {
  await ensureDefaultTeacher();
  if (getSession()) {
    showLoginScreen(false);
    loadLocal();
    populateSelects();
    renderGhStatus();
    renderAll();
    document.getElementById('print-date').value = today();
  } else {
    showLoginScreen(true);
  }
})();
