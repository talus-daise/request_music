let timer;
let countdownTimer;
let current = null;
let player = null;
let remain = 300;
let isAdvancing = false;

window.addEventListener('DOMContentLoaded', () => {

  const nowEl = document.getElementById('now');
  const countdownEl = document.getElementById('countdown');
  const requesterEl = document.getElementById('requester');
  const ytEl = document.getElementById('yt');
  const startBtn = document.getElementById('start-btn');
  const overlay = document.getElementById('start-overlay');
  const nextBtn = document.getElementById('next-btn');
  const confirmModal = document.getElementById('confirm-modal');
  const cancelNextBtn = document.getElementById('cancel-next-btn');
  const confirmNextBtn = document.getElementById('confirm-next-btn');

  async function pickAndPlay() {

    isAdvancing = false;
    clearTimeout(timer);
    clearInterval(countdownTimer);

    try {

      const res = await fetch('/api/random-song');
      const data = await res.json();

      if (!res.ok || !data.youtube_id) {
        nowEl.textContent = data.error || '曲なし';
        return;
      }

      current = data;

      nowEl.textContent =
        `再生中: ${data.title}`;

      requesterEl.textContent = data.student_id || '--';

      remain = data.max_duration_sec || 300;

      countdownEl.textContent =
        `次曲まで: ${remain}秒`;

      // YouTube Playerの初期化または動画の読み込み
      if (!player) {
        player = new YT.Player('yt', {
          videoId: data.youtube_id,
          playerVars: {
            autoplay: 1,
            controls: 0,
            rel: 0,
            enablejsapi: 1,
            end: 300 // 5分で強制終了
          },
          events: {
            onStateChange: (event) => {
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

        remain--;

        countdownEl.textContent =
          `次曲まで: ${remain}秒`;

        if (remain <= 0) {
          finishTrack();
        }

      }, 1000);

      timer = setTimeout(
        finishTrack,
        remain * 1000
      );

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

    clearTimeout(timer);
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
