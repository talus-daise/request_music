let player; let timer; let countdownTimer; let current = null; let remain = 300;
const nowEl = document.getElementById('now');
const countdownEl = document.getElementById('countdown');

async function pickAndPlay() {
  clearTimeout(timer); clearInterval(countdownTimer);
  const res = await fetch('/api/random-song');
  const data = await res.json();
  if (!res.ok) { nowEl.textContent = data.error || '曲なし'; return; }
  current = data;
  nowEl.textContent = `再生中: ${data.title} / ${data.student_id} / ${data.recommendation || 'おすすめコメントなし'}`;
  remain = data.max_duration_sec || 300;
  countdownEl.textContent = `次曲まで: ${remain}秒`;
  if (!player) {
    player = new YT.Player('yt', { videoId: data.youtube_id, playerVars: { autoplay: 1 }, events: { onStateChange } });
  } else {
    player.loadVideoById(data.youtube_id);
  }
  countdownTimer = setInterval(() => { remain--; countdownEl.textContent = `次曲まで: ${remain}秒`; if (remain <= 0) finishTrack(); }, 1000);
  timer = setTimeout(finishTrack, remain * 1000);
}

async function finishTrack() {
  if (!current) return;
  await fetch('/api/song-played', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: current.id }) });
  pickAndPlay();
}

function onStateChange(e) {
  if (e.data === YT.PlayerState.ENDED) finishTrack();
  if (e.data === YT.PlayerState.UNSTARTED) setTimeout(() => {
    // 埋め込み失敗や再生ブロック時の保険
    const s = player.getPlayerState();
    if (s === YT.PlayerState.UNSTARTED || s === YT.PlayerState.CUED) finishTrack();
  }, 5000);
}

window.onYouTubeIframeAPIReady = pickAndPlay;
