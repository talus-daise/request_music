let timer;
let countdownTimer;
let current = null;
let player = null;
let remain = 300;

window.addEventListener('DOMContentLoaded', () => {

  const nowEl = document.getElementById('now');
  const countdownEl = document.getElementById('countdown');
  const ytEl = document.getElementById('yt');
  const startBtn = document.getElementById('start-btn');
  const overlay = document.getElementById('start-overlay');

  async function pickAndPlay() {

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
        `再生中: ${data.title} / ${data.student_id}`;

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

    if (!current) return;

    const played = current;
    current = null;

    clearTimeout(timer);
    clearInterval(countdownTimer);

    // iframe停止
    if (player && typeof player.stopVideo === 'function') {
      player.stopVideo();
    }

    try {

      await fetch('/api/song-played', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          request_id: played.id
        })
      });

    } catch (e) {

      console.error(e);

    }

    pickAndPlay();

  }

  // ボタンが押されたらオーバーレイを消して再生開始
  startBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    pickAndPlay();
  }, { once: true });

});