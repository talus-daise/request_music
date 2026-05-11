const studentSelect = document.getElementById('student_id');
studentSelect.insertAdjacentHTML('beforeend', `<option value="#" disabled>番号を選択してください</option>`);
for (let i = 1; i <= 40; i++) {
  const v = `3A${String(i).padStart(2, '0')}`;
  studentSelect.insertAdjacentHTML('beforeend', `<option value="${v}">${v}</option>`);
}

const form = document.getElementById('requestForm');
const msg = document.getElementById('message');
const unplayedOnly = document.getElementById('unplayedOnly');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '送信中...';
  const payload = {
    student_id: document.getElementById('student_id').value,
    title: document.getElementById('title').value,
    recommendation: document.getElementById('recommendation').value,
    youtube_url: document.getElementById('youtube_url').value
  };
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
  document.getElementById('list').innerHTML = (data.requests || []).map(r => `<article><b>${escapeHtml(r.title)}</b> (${r.student_id})<br>${escapeHtml(r.recommendation || '')}<br><small>${r.created_at}</small></article>`).join('');
  document.getElementById('studentStats').innerHTML = (data.studentStats || []).map(s => `<div>${s.student_id}: 投稿${s.posted_count} / 再生${s.played_count}</div>`).join('');
}

async function loadHistory() {
  const res = await fetch('/api/history');
  const data = await res.json();
  document.getElementById('history').innerHTML = (data.history || []).map(h => `<div>${h.played_at} - ${escapeHtml(h.title)} (${h.student_id})</div>`).join('');
}

function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

loadRequests(); loadHistory();
