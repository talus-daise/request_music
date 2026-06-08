const studentSelect = document.getElementById('student_id');
studentSelect.insertAdjacentHTML('beforeend', `<option value="#" selected disabled>番号を選択してください</option>`);
for (let i = 1; i <= 40; i++) {
  const v = `3A${String(i).padStart(2, '0')}`;
  studentSelect.insertAdjacentHTML('beforeend', `<option value="${v}">${v}</option>`);
}

const form = document.getElementById('requestForm');
const msg = document.getElementById('message');
const unplayedOnly = document.getElementById('unplayedOnly');
const jstDateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    student_id: document.getElementById('student_id').value,
    title: document.getElementById('title').value,
    recommendation: document.getElementById('recommendation').value,
    youtube_url: document.getElementById('youtube_url').value
  };

  const accepted = window.confirm(`学籍番号は ${payload.student_id} で合っていますか？`);
  if (!accepted) {
    msg.textContent = '投稿を中止しました。';
    return;
  }

  msg.textContent = '送信中...';
  const res = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  msg.textContent = data.message || data.error || '完了';
  if (res.ok) { form.reset(); await Promise.all([loadRequests(), loadHistory()]); }
});

unplayedOnly.addEventListener('change', loadRequests);

async function loadRequests() {
  const qp = unplayedOnly.checked ? '?unplayedOnly=1' : '';
  const res = await fetch(`/api/requests${qp}`);
  const data = await res.json();
  document.getElementById('stats').textContent = `総投稿数: ${data.stats.total_requests ?? 0} / 本日再生済み: ${data.stats.today_played ?? 0} / 未再生: ${data.stats.unplayed_count ?? 0}`;
  document.getElementById('list').innerHTML = (data.requests || []).map((r) => `<article><b>${escapeHtml(r.title)}</b> (${escapeHtml(r.student_id)})<br>${escapeHtml(r.recommendation || '')}<br><small>投稿: ${escapeHtml(formatJstDateTime(r.created_at))}</small></article>`).join('');
  renderStudentStats(data.studentStats || []);
}

async function loadHistory() {
  const res = await fetch('/api/history');
  const data = await res.json();
  document.getElementById('history').innerHTML = (data.history || []).map((h) => `<div><time>${escapeHtml(formatJstDateTime(h.played_at))}</time><span>${escapeHtml(h.title)} (${escapeHtml(h.student_id)})</span></div>`).join('');
}

function renderStudentStats(studentStats) {
  const studentStatsEl = document.getElementById('studentStats');
  const summaryEl = document.getElementById('studentStatsSummary');
  const totalPosted = studentStats.reduce((sum, student) => sum + Number(student.posted_count || 0), 0);
  const totalPlayed = studentStats.reduce((sum, student) => sum + Number(student.played_count || 0), 0);
  const maxPosted = Math.max(...studentStats.map((student) => Number(student.posted_count || 0)), 1);
  const topStudent = studentStats[0];

  summaryEl.innerHTML = `
    <div><span>投稿者数</span><strong>${studentStats.length}</strong></div>
    <div><span>投稿合計</span><strong>${totalPosted}</strong></div>
    <div><span>再生済み</span><strong>${totalPlayed}</strong></div>
    <div><span>最多投稿</span><strong>${topStudent ? `${escapeHtml(topStudent.student_id)} / ${escapeHtml(topStudent.posted_count)}` : 'なし'}</strong></div>
  `;

  if (studentStats.length === 0) {
    studentStatsEl.innerHTML = '<p class="empty-state">まだ投稿者別統計はありません。</p>';
    return;
  }

  studentStatsEl.innerHTML = studentStats.map((student, index) => {
    const postedCount = Number(student.posted_count || 0);
    const playedCount = Number(student.played_count || 0);
    const waitingCount = Math.max(postedCount - playedCount, 0);
    const postedPercent = Math.round((postedCount / maxPosted) * 100);
    const playedPercent = postedCount > 0 ? Math.round((playedCount / postedCount) * 100) : 0;
    const rankLabel = index === 0 ? 'Top' : `#${index + 1}`;

    return `
      <article class="student-stat-card">
        <div class="student-stat-head">
          <div>
            <span class="rank-pill">${rankLabel}</span>
            <strong>${escapeHtml(student.student_id)}</strong>
          </div>
          <span class="played-rate">再生率 ${playedPercent}%</span>
        </div>
        <div class="student-stat-numbers" aria-label="${escapeHtml(student.student_id)}の投稿状況">
          <span><b>${postedCount}</b>投稿</span>
          <span><b>${playedCount}</b>再生</span>
          <span><b>${waitingCount}</b>未再生</span>
        </div>
        <div class="stat-meter" aria-hidden="true">
          <span style="width: ${postedPercent}%"></span>
        </div>
      </article>
    `;
  }).join('');
}

function formatJstDateTime(value) {
  if (!value) {
    return 'なし';
  }

  const normalizedValue = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${jstDateTimeFormatter.format(date)} JST`;
}

function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

loadRequests(); loadHistory();
