let countdownTimer;
let current = null;
let player = null;
let remain = 300;
let isAdvancing = false;
let isCountdownDurationSynced = false;

const MAX_PLAY_SECONDS = 300;

window.addEventListener('DOMContentLoaded', () => {

  const nowEl = document.getElementById('now');
  const countdownEl = document.getElementById('countdown');
  const requesterEl = document.getElementById('requester');
  const startBtn = document.getElementById('start-btn');
  const overlay = document.getElementById('start-overlay');
  const nextBtn = document.getElementById('next-btn');
  const confirmModal = document.getElementById('confirm-modal');
  const cancelNextBtn = document.getElementById('cancel-next-btn');
  const confirmNextBtn = document.getElementById('confirm-next-btn');

  function updateCountdownText() {
    countdownEl.textContent = `次曲まで: ${remain}秒`;
  }

  function getVideoDurationLimit() {
    if (!player || typeof player.getDuration !== 'function') {
      return null;
    }

    const duration = player.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    return Math.min(Math.ceil(duration), MAX_PLAY_SECONDS);
  }

  function syncCountdownWithVideoDuration() {
    if (!current || isCountdownDurationSynced) return;

    const durationLimit = getVideoDurationLimit();
    if (durationLimit === null) return;

    isCountdownDurationSynced = true;
    remain = durationLimit;
    updateCountdownText();
  }

  function isVideoPlaying() {
    return Boolean(
      player &&
      typeof player.getPlayerState === 'function' &&
      player.getPlayerState() === YT.PlayerState.PLAYING
    );
  }

  async function pickAndPlay() {

    isAdvancing = false;
    clearInterval(countdownTimer);

    try {

      const res = await fetch('/api/random-song');
      const data = await res.json();

      if (!res.ok || !data.youtube_id) {
        nowEl.textContent = data.error || '曲なし';
        return;
      }

      current = data;
      isCountdownDurationSynced = false;

      nowEl.textContent =
        `再生中: ${data.title}`;

      requesterEl.textContent = data.student_id || '--';

      remain = data.max_duration_sec || MAX_PLAY_SECONDS;
      updateCountdownText();

      // YouTube Playerの初期化または動画の読み込み
      if (!player) {
        player = new YT.Player('yt', {
          videoId: data.youtube_id,
          playerVars: {
            autoplay: 1,
            controls: 0,
            rel: 0,
            enablejsapi: 1,
            end: MAX_PLAY_SECONDS // 5分で強制終了
          },
          events: {
            onReady: () => {
              syncCountdownWithVideoDuration();
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                syncCountdownWithVideoDuration();
              }

              // 動画が終了（ENDED）したら即座に次へ
              if (event.data === YT.PlayerState.ENDED) {
                finishTrack();
              }
            }
          }
        });
      } else {
        player.loadVideoById(data.youtube_id);
      }

      countdownTimer = setInterval(() => {

        if (!isVideoPlaying()) {
          return;
        }

        remain = Math.max(0, remain - 1);
        updateCountdownText();

        if (remain <= 0) {
          finishTrack();
        }

      }, 1000);

    } catch (e) {

      console.error(e);
      nowEl.textContent = '通信エラー';

    }
  }

  async function finishTrack() {

    if (!current || isAdvancing) return;

    isAdvancing = true;

    const played = current;
    current = null;

    clearInterval(countdownTimer);

    // iframe停止
    if (player && typeof player.stopVideo === 'function') {
      player.stopVideo();
    }

    try {

      const res = await fetch('/api/song-played', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          request_id: played.id
        })
      });

      if (!res.ok) {
        throw new Error('Failed to update played status');
      }

    } catch (e) {

      console.error('再生済みステータスの更新に失敗しました:', e);
      // 失敗しても次に進むが、サーバー側でエラーログを確認することを推奨

    }

    await pickAndPlay();

  }

  function openConfirmModal() {

    if (!current) return;
    confirmModal.hidden = false;
    confirmModal.style.display = "grid";

  }

  function closeConfirmModal() {

    confirmModal.hidden = true;
    confirmModal.style.display = "none";

  }

  // ボタンが押されたらオーバーレイを消して再生開始
  startBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    pickAndPlay();
  }, { once: true });

  nextBtn.addEventListener('click', openConfirmModal);
  cancelNextBtn.addEventListener('click', closeConfirmModal);
  confirmNextBtn.addEventListener('click', async () => {
    closeConfirmModal();
    await finishTrack();
  });
  confirmModal.addEventListener('click', (event) => {
    if (event.target === confirmModal) {
      closeConfirmModal();
    }
  });

});
