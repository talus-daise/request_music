const students = Array.from({ length: 40 }, (_, index) => `3A${String(index + 1).padStart(2, '0')}`);
const studentSelect = document.getElementById('edit_student_id');
const unplayedOnly = document.getElementById('unplayedOnly');
const editForm = document.getElementById('editForm');
const messageEl = document.getElementById('message');
const listEl = document.getElementById('list');
const statsEl = document.getElementById('stats');
const listCountEl = document.getElementById('listCount');
const editMetaEl = document.getElementById('editMeta');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');

let requests = [];
let selectedId = null;
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

studentSelect.insertAdjacentHTML('beforeend', '<option value="" selected disabled>番号を選択してください</option>');
for (const studentId of students) {
  studentSelect.insertAdjacentHTML('beforeend', `<option value="${studentId}">${studentId}</option>`);
}

unplayedOnly.addEventListener('change', () => {
  selectedId = null;
  resetEditor();
  loadRequests();
});

editForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedId) {
    messageEl.textContent = '先に曲を選択してください。';
    return;
  }

  const payload = {
    student_id: document.getElementById('edit_student_id').value,
    title: document.getElementById('edit_title').value,
    recommendation: document.getElementById('edit_recommendation').value,
    youtube_url: document.getElementById('edit_youtube_url').value
  };

  messageEl.textContent = '保存中...';

  try {
    const response = await fetch(`/api/requests/${selectedId}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    messageEl.textContent = data.message || data.error || '保存しました。';

    if (!response.ok) {
      return;
    }

    await loadRequests();
    selectRequest(selectedId);
  } catch (error) {
    console.error(error);
    messageEl.textContent = '保存中に通信エラーが発生しました。';
  }
});

deleteBtn.addEventListener('click', async () => {
  if (!selectedId) {
    messageEl.textContent = '先に曲を選択してください。';
    return;
  }

  const selectedRequest = requests.find((request) => request.id === selectedId);
  const title = selectedRequest?.title || '選択中の曲';
  if (!window.confirm(`「${title}」を削除します。この操作は取り消せません。`)) {
    return;
  }

  messageEl.textContent = '削除中...';
  deleteBtn.disabled = true;
  saveBtn.disabled = true;

  try {
    const response = await fetch(`/api/requests/${selectedId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    messageEl.textContent = data.message || data.error || '削除しました。';

    if (!response.ok) {
      deleteBtn.disabled = false;
      saveBtn.disabled = false;
      return;
    }

    selectedId = null;
    resetEditor('曲を削除しました。');
    await loadRequests();
  } catch (error) {
    console.error(error);
    messageEl.textContent = '削除中に通信エラーが発生しました。';
    deleteBtn.disabled = false;
    saveBtn.disabled = false;
  }
});

async function loadRequests() {
  const query = unplayedOnly.checked ? '?unplayedOnly=1' : '';
  const response = await fetch(`/api/requests${query}`);
  const data = await response.json();

  requests = data.requests || [];
  statsEl.textContent = `総投稿数: ${data.stats.total_requests ?? 0} / 本日再生済み: ${data.stats.today_played ?? 0} / 未再生: ${data.stats.unplayed_count ?? 0}`;
  listCountEl.textContent = `${requests.length}件を表示中`;

  renderList();

  if (!requests.some((request) => request.id === selectedId)) {
    selectedId = requests[0]?.id ?? null;
  }

  if (selectedId) {
    selectRequest(selectedId);
  } else {
    resetEditor('表示できる曲がありません。');
  }
}

function renderList() {
  listEl.innerHTML = requests.map((request) => {
    const status = Number(request.played) === 1 ? 'played' : 'waiting';
    const recommendation = request.recommendation ? `<p>${escapeHtml(request.recommendation)}</p>` : '';
    const selectedClass = request.id === selectedId ? ' selected' : '';

    return `
      <article class="request-card status-${status}${selectedClass}" data-id="${request.id}">
        <div class="request-card-head">
          <div>
            <b>${escapeHtml(request.title)}</b>
            <small>${escapeHtml(request.student_id)}</small>
          </div>
          <span class="status-pill">${Number(request.played) === 1 ? '再生済み' : '未再生'}</span>
        </div>
        ${recommendation}
        <dl class="request-meta">
          <div><dt>投稿</dt><dd>${escapeHtml(formatJstDateTime(request.created_at))}</dd></div>
          <div><dt>YouTube</dt><dd>${escapeHtml(`https://youtu.be/${request.youtube_id}`)}</dd></div>
          <div><dt>再生回数</dt><dd>${escapeHtml(String(request.play_count ?? 0))}</dd></div>
        </dl>
        <button type="button" class="mini-button" data-edit-id="${request.id}">この曲を編集</button>
      </article>
    `;
  }).join('');

  listEl.querySelectorAll('[data-edit-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextId = Number(button.getAttribute('data-edit-id'));
      selectRequest(nextId);
    });
  });
}

function selectRequest(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request) {
    return;
  }

  selectedId = request.id;
  renderList();

  document.getElementById('edit_id').value = String(request.id);
  document.getElementById('edit_student_id').value = request.student_id;
  document.getElementById('edit_title').value = request.title;
  document.getElementById('edit_recommendation').value = request.recommendation || '';
  document.getElementById('edit_youtube_url').value = `https://youtu.be/${request.youtube_id}`;
  editMetaEl.textContent = `ID ${request.id} / ${Number(request.played) === 1 ? '再生済み' : '未再生'} / 最終再生: ${formatJstDateTime(request.last_played_at)}`;
  saveBtn.disabled = false;
  deleteBtn.disabled = false;
}

function resetEditor(metaText = '曲を選択すると詳細を表示します。') {
  editForm.reset();
  document.getElementById('edit_id').value = '';
  editMetaEl.textContent = metaText;
  saveBtn.disabled = true;
  deleteBtn.disabled = true;
  studentSelect.selectedIndex = 0;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

loadRequests();
