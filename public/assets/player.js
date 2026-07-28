let countdownTimer;
let syncTimer;
let current = null;
let player = null;
let isAdvancing = false;
let hasUserStarted = false;
let lastVideoId = null;

const MAX_PLAY_SECONDS = 300;
const SYNC_INTERVAL_MS = 2000;
const SEEK_TOLERANCE_SECONDS = 2;

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

  function updateCountdownText(remaining) {
    countdownEl.textContent = `次曲まで: ${Math.max(0, remaining)}秒`;
  }

  function updateInfo(state) {
    if (state.status !== 'playing' || !state.youtube_id) {
      nowEl.textContent = state.error || '曲なし';
      requesterEl.textContent = '--';
      updateCountdownText(0);
      return;
    }

    nowEl.textContent = `再生中: ${state.title}`;
    requesterEl.textContent = state.student_id || '--';
    updateCountdownText(state.remaining_sec ?? state.duration_sec ?? MAX_PLAY_SECONDS);
  }

  function isVideoPlaying() {
    return Boolean(
      player &&
      typeof player.getPlayerState === 'function' &&
      player.getPlayerState() === YT.PlayerState.PLAYING
    );
  }

  async function readJsonResponse(res) {
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return res.json();
    }

    const text = await res.text();
    return {
      error: text ? `APIがJSONではない応答を返しました (${res.status})` : `APIエラー (${res.status})`
    };
  }

  function syncPlayerPosition(state) {
    if (!player || !state.youtube_id || !hasUserStarted) return;

    const targetPosition = Math.max(0, state.position_sec ?? 0);

    if (lastVideoId !== state.youtube_id) {
      lastVideoId = state.youtube_id;
      player.loadVideoById({
        videoId: state.youtube_id,
        startSeconds: targetPosition
      });
      return;
    }

    if (typeof player.getCurrentTime !== 'function' || typeof player.seekTo !== 'function') return;

    const currentPosition = player.getCurrentTime();
    if (Number.isFinite(currentPosition) && Math.abs(currentPosition - targetPosition) > SEEK_TOLERANCE_SECONDS) {
      player.seekTo(targetPosition, true);
      if (!isVideoPlaying() && typeof player.playVideo === 'function') {
        player.playVideo();
      }
    }
  }

  function createPlayer(state) {
    const startSeconds = Math.max(0, state.position_sec ?? 0);
    lastVideoId = state.youtube_id;

    player = new YT.Player('yt', {
      videoId: state.youtube_id,
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        enablejsapi: 1,
        start: startSeconds,
        end: Math.min(state.duration_sec ?? MAX_PLAY_SECONDS, MAX_PLAY_SECONDS)
      },
      events: {
        onReady: (event) => {
          event.target.seekTo(startSeconds, true);
          event.target.playVideo();
        },
        onStateChange: (event) => {
          if (event.data === YT.PlayerState.ENDED) {
            finishTrack();
          }
        }
      }
    });
  }

  function applyState(state) {
    current = state;
    updateInfo(state);

    if (state.status !== 'playing' || !state.youtube_id) {
      if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
      }
      lastVideoId = null;
      return;
    }

    if (!hasUserStarted) return;

    if (!player) {
      createPlayer(state);
      return;
    }

    syncPlayerPosition(state);
  }

  async function fetchPlaybackState() {
    const res = await fetch('/api/playback-state');
    const state = await readJsonResponse(res);

    if (!res.ok) {
      throw new Error(state.error || 'Failed to fetch playback state');
    }

    applyState(state);
    return state;
  }

  async function advancePlayback() {
    const res = await fetch('/api/playback-next', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        current_request_id: current?.request_id ?? null
      })
    });
    const state = await readJsonResponse(res);

    applyState(state);

    if (!res.ok && res.status !== 404) {
      throw new Error(state.error || 'Failed to advance playback');
    }

    return state;
  }

  function startLocalCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (!current || current.status !== 'playing') return;

      const startedAt = current.started_at ? new Date(`${current.started_at.replace(' ', 'T')}Z`) : null;
      if (!startedAt) return;

      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
      const remaining = Math.max(0, (current.duration_sec ?? MAX_PLAY_SECONDS) - elapsed);
      updateCountdownText(remaining);

      if (remaining <= 0 && hasUserStarted) {
        finishTrack();
      }
    }, 1000);
  }

  function startSyncLoop() {
    clearInterval(syncTimer);
    syncTimer = setInterval(async () => {
      try {
        await fetchPlaybackState();
      } catch (e) {
        console.error(e);
        nowEl.textContent = '同期エラー';
      }
    }, SYNC_INTERVAL_MS);
  }

  async function beginPlayback() {
    hasUserStarted = true;
    overlay.style.display = 'none';
    startLocalCountdown();
    startSyncLoop();

    try {
      const state = await fetchPlaybackState();
      if (state.status !== 'playing') {
        await advancePlayback();
      }
    } catch (e) {
      console.error(e);
      nowEl.textContent = '通信エラー';
    }
  }

  async function finishTrack() {

    if (!current || isAdvancing || current.status !== 'playing') return;

    isAdvancing = true;

    try {
      await advancePlayback();
    } catch (e) {
      console.error('次の曲への同期に失敗しました:', e);
    } finally {
      isAdvancing = false;
    }

  }

  function openConfirmModal() {

    if (!current || current.status !== 'playing') return;
    confirmModal.hidden = false;
    confirmModal.style.display = "grid";

  }

  function closeConfirmModal() {

    confirmModal.hidden = true;
    confirmModal.style.display = "none";

  }

  fetchPlaybackState().catch(() => {
    nowEl.textContent = '同期待機中';
  });
  startSyncLoop();

  startBtn.addEventListener('click', beginPlayback, { once: true });
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
