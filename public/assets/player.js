let countdownTimer;
let syncTimer;
let current = null;
let player = null;
let isAdvancing = false;
let hasUserStarted = false;
let lastVideoId = null;
let heartbeatTimer;
let reportedDurationForRequestId = null;
let reportingDurationForRequestId = null;

// Countdown sync model:
// The server is the single source of truth and returns an absolute deadline
// (ends_at) plus its own clock (server_now). On every sync the local deadline
// is re-derived from those two absolute values, never by adjusting a running
// local counter, so repeated syncs cannot accumulate error (the old anchor
// logic re-based a floored remaining_sec on every sync and only ever moved
// the deadline earlier, which made the countdown drift and finish early).
let deadlineMs = null;
// While paused (shared state or a pause this device just reported and the
// server has not confirmed yet) the countdown is frozen at this value.
let frozenRemainingMs = null;
let pauseRequestId = null;
let resumeRequestId = null;
let hasPlayedCurrentVideo = false;
// A PAUSED event is not proof that the user paused the video: the player
// also fires PAUSED (asynchronously) for our own loadVideoById / seekTo /
// playVideo calls, e.g. right when a track starts. Reporting those as a
// manual pause paused the shared state and broke autoplay. So a pause is
// first only suspected (the local countdown freezes immediately), and is
// reported to the server only if the player is still paused after a short
// confirmation window and we did not touch the player in the meantime.
let pendingPause = null;
let pendingPauseTimer = null;
let lastProgrammaticActionAt = 0;

const MAX_PLAY_SECONDS = 300;
const SYNC_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 250;
const SEEK_TOLERANCE_SECONDS = 2;
const HEARTBEAT_INTERVAL_MS = 5000;
const PAUSE_CONFIRM_MS = 1200;
const CLIENT_ID_STORAGE_KEY = "requestMusicPlaybackClientId";

window.addEventListener('DOMContentLoaded', () => {

  const nowEl = document.getElementById('now');
  const countdownEl = document.getElementById('countdown');
  const requesterEl = document.getElementById('requester');
  const startBtn = document.getElementById('start-btn');
  const overlay = document.getElementById('start-overlay');
  const nextBtn = document.getElementById('next-btn');
  const nextDrawer = document.getElementById('next-drawer');
  const nextDrawerToggle = document.getElementById('next-drawer-toggle');
  const confirmModal = document.getElementById('confirm-modal');
  const cancelNextBtn = document.getElementById('cancel-next-btn');
  const confirmNextBtn = document.getElementById('confirm-next-btn');
  const disableCaptionsBtn = document.getElementById('disable-captions-btn');

  function disableCaptions() {
    if (!player) return;
    try {
      if (typeof player.unloadModule === 'function') {
        player.unloadModule('captions');
        player.unloadModule('cc');
      }
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
        player.setOption('cc', 'track', {});
      }
    } catch (e) {
      console.warn('字幕の非表示処理実行時の警告:', e);
    }
  }

  function isActiveState(state) {
    return Boolean(state && state.youtube_id && (state.status === 'playing' || state.status === 'paused'));
  }

  function isPausedState(state) {
    if (!isActiveState(state)) return false;
    // A pause this device reported (or is about to report, see pendingPause)
    // counts as paused immediately, even before the server state comes back,
    // so neither the countdown nor the position sync can run ahead of (or
    // undo) the user's pause in the meantime.
    return state.status === 'paused'
      || pauseRequestId === state.request_id
      || pendingPause?.requestId === state.request_id;
  }

  function noteProgrammaticAction() {
    lastProgrammaticActionAt = Date.now();
    dropPendingPause();
  }

  function dropPendingPause() {
    if (pendingPauseTimer !== null) {
      clearTimeout(pendingPauseTimer);
      pendingPauseTimer = null;
    }
    pendingPause = null;
  }

  // A suspected pause turned out to be spurious (the video is playing
  // again): resume the local countdown from the frozen value until the next
  // sync re-derives the exact deadline.
  function releaseFrozenCountdown() {
    if (deadlineMs === null && frozenRemainingMs !== null && current?.status === 'playing') {
      deadlineMs = Date.now() + frozenRemainingMs;
    }
    frozenRemainingMs = null;
  }

  function updateCountdownText(remaining) {
    countdownEl.textContent = `次曲まで: ${Math.max(0, remaining)}秒`;
  }

  function updateInfo(state) {
    if (!isActiveState(state)) {
      nowEl.textContent = state?.error || '曲なし';
      requesterEl.textContent = '--';
      updateCountdownText(0);
      return;
    }

    nowEl.textContent = `${isPausedState(state) ? '一時停止中' : '再生中'}: ${state.title}`;
    requesterEl.textContent = state.student_id || '--';
    updateCountdownText(getRemainingSeconds());
  }

  function getRemainingMs() {
    if (!isActiveState(current)) return 0;
    if (isPausedState(current)) {
      if (frozenRemainingMs !== null) return Math.max(0, frozenRemainingMs);
      return Math.max(0, Number(current.remaining_sec ?? 0) * 1000);
    }
    if (deadlineMs === null) {
      return Math.max(0, Number(current.remaining_sec ?? current.duration_sec ?? MAX_PLAY_SECONDS) * 1000);
    }
    return Math.max(0, deadlineMs - Date.now());
  }

  function getRemainingSeconds() {
    return Math.ceil(getRemainingMs() / 1000);
  }

  function syncCountdown(state, receivedAtMs) {
    if (!isActiveState(state)) {
      deadlineMs = null;
      frozenRemainingMs = null;
      return;
    }

    if (state.status === 'paused') {
      deadlineMs = null;
      frozenRemainingMs = Math.max(0, Number(state.remaining_sec ?? 0) * 1000);
      return;
    }

    // This device paused the track and the pause is not confirmed yet: keep
    // the frozen value instead of adopting a stale "playing" deadline.
    if (pauseRequestId === state.request_id || pendingPause?.requestId === state.request_id) return;

    const serverNowMs = Date.parse(state.server_now ?? '');
    const endsAtMs = state.ends_at
      ? Date.parse(state.ends_at)
      : (Number.isFinite(serverNowMs) ? serverNowMs + Number(state.remaining_sec ?? 0) * 1000 : NaN);

    // Re-derive the absolute local deadline from the server's absolute
    // deadline and clock. Every sync lands on the same deadline (within
    // network jitter), so nothing accumulates no matter how often we sync.
    deadlineMs = Number.isFinite(endsAtMs) && Number.isFinite(serverNowMs)
      ? receivedAtMs + (endsAtMs - serverNowMs)
      : receivedAtMs + Math.max(0, Number(state.remaining_sec ?? 0) * 1000);
    frozenRemainingMs = null;
  }

  function isVideoPlaying() {
    return Boolean(
      player &&
      typeof player.getPlayerState === 'function' &&
      player.getPlayerState() === YT.PlayerState.PLAYING
    );
  }

  function getPlayerPositionSec() {
    if (!player || typeof player.getCurrentTime !== 'function') return null;
    const position = Number(player.getCurrentTime());
    return Number.isFinite(position) ? position : null;
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

  function getClientId() {
    const existing = sessionStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;

    const generated = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
    return generated;
  }

  const clientId = getClientId();

  // Whether this device is actually playing the video (or actively trying
  // to, while buffering). The server stops the shared playback when no
  // device reports this for a while, so a track nobody hears is not
  // consumed by the timer alone.
  function isActivelyPlaying() {
    if (!player || typeof player.getPlayerState !== 'function') return false;
    const playerState = player.getPlayerState();
    return playerState === YT.PlayerState.PLAYING || playerState === YT.PlayerState.BUFFERING;
  }

  async function sendPlaybackClientEvent(path, keepalive = false, extra = {}) {
    const payload = JSON.stringify({ client_id: clientId, ...extra });
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: payload,
      keepalive
    });

    if (!res.ok) {
      const data = await readJsonResponse(res);
      throw new Error(data.error || `Failed to send playback client event (${res.status})`);
    }
  }

  async function sendHeartbeat() {
    await sendPlaybackClientEvent('/api/playback-heartbeat', false, { playing: isActivelyPlaying() });
  }

  function startHeartbeat() {
    clearInterval(heartbeatTimer);
    sendHeartbeat().catch((e) => console.error('再生デバイスのheartbeatに失敗しました:', e));
    heartbeatTimer = setInterval(() => {
      sendHeartbeat().catch((e) => console.error('再生デバイスのheartbeatに失敗しました:', e));
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function notifyPlaybackLeave() {
    if (!hasUserStarted) return;

    stopHeartbeat();
    const payload = JSON.stringify({ client_id: clientId });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/playback-leave', new Blob([payload], { type: 'application/json' }));
      return;
    }

    fetch('/api/playback-leave', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }

  function syncPlayerPosition(state) {
    if (!player || !state.youtube_id || !hasUserStarted) return;

    const targetPosition = Math.max(0, Number(state.position_sec ?? 0));

    if (isPausedState(state)) {
      // Paused is shared: hold this device at the frozen position and never
      // start playback. A resume this device already reported wins over a
      // stale paused state that is still in flight.
      if (state.status === 'paused' && resumeRequestId === state.request_id) return;

      // The pause is only suspected/reported by this device so far, not
      // confirmed by the server: touch nothing. Seeking here would stamp a
      // programmatic action inside the confirmation window and could cancel
      // a genuine manual pause before it is reported.
      if (state.status !== 'paused') return;

      if (lastVideoId !== state.youtube_id) {
        lastVideoId = state.youtube_id;
        hasPlayedCurrentVideo = false;
        noteProgrammaticAction();
        if (typeof player.cueVideoById === 'function') {
          player.cueVideoById({ videoId: state.youtube_id, startSeconds: targetPosition });
        } else {
          player.loadVideoById({ videoId: state.youtube_id, startSeconds: targetPosition });
          player.pauseVideo?.();
        }
        return;
      }

      const currentPosition = getPlayerPositionSec();
      if (currentPosition !== null && Math.abs(currentPosition - targetPosition) > SEEK_TOLERANCE_SECONDS) {
        noteProgrammaticAction();
        player.seekTo(targetPosition, true);
      }
      if (isVideoPlaying() && typeof player.pauseVideo === 'function') {
        noteProgrammaticAction();
        player.pauseVideo();
      }
      return;
    }

    // The server still says "playing" but this device just asked to pause:
    // do not seek or restart the video behind the user's back.
    if (pauseRequestId === state.request_id) return;

    if (lastVideoId !== state.youtube_id) {
      lastVideoId = state.youtube_id;
      hasPlayedCurrentVideo = false;
      noteProgrammaticAction();
      player.loadVideoById({
        videoId: state.youtube_id,
        startSeconds: targetPosition
      });
      return;
    }

    if (typeof player.seekTo === 'function' && typeof player.getCurrentTime === 'function') {
      const currentPosition = player.getCurrentTime();
      if (Number.isFinite(currentPosition) && Math.abs(currentPosition - targetPosition) > SEEK_TOLERANCE_SECONDS) {
        noteProgrammaticAction();
        player.seekTo(targetPosition, true);
      }
    }

    // The shared state is playing, so this player should be playing too.
    // Drive it there from ANY stopped state, not just PAUSED: when autoplay
    // does not engage, the player can sit in CUED (showing its big play
    // button) or UNSTARTED while the server-side timer keeps running, and
    // only a playVideo() call gets it going. This also follows a resume
    // shared from another device. A manual pause never reaches this branch:
    // it turns the shared state (or the pending-pause guard above) to
    // paused first. BUFFERING is left alone (playback is on its way) and
    // ENDED is left to the track-advance flow.
    if (typeof player.getPlayerState === 'function' && typeof player.playVideo === 'function') {
      const playerState = player.getPlayerState();
      if (
        playerState !== YT.PlayerState.PLAYING &&
        playerState !== YT.PlayerState.BUFFERING &&
        playerState !== YT.PlayerState.ENDED
      ) {
        noteProgrammaticAction();
        try {
          player.playVideo();
        } catch (e) {
          console.warn('再生開始の呼び出しに失敗しました:', e);
        }
      }
    }
  }

  function createPlayer(state) {
    const startSeconds = Math.max(0, Number(state.position_sec ?? 0));
    lastVideoId = state.youtube_id;
    hasPlayedCurrentVideo = false;
    noteProgrammaticAction();

    player = new YT.Player('yt', {
      videoId: state.youtube_id,
      playerVars: {
        autoplay: 1,
        controls: 0,
        rel: 0,
        enablejsapi: 1,
        cc_load_policy: 0,
        hl: 'ja',
        origin: window.location.origin,
        start: startSeconds,
        end: Math.min(state.duration_sec ?? MAX_PLAY_SECONDS, MAX_PLAY_SECONDS)
      },
      events: {
        onReady: (event) => {
          disableCaptions();
          noteProgrammaticAction();
          event.target.seekTo(startSeconds, true);
          // Only a server-confirmed pause may hold the first playback; a
          // locally suspected pause must never block autoplay.
          if (current?.status === 'paused') {
            event.target.pauseVideo();
          } else {
            event.target.playVideo();
          }
          reportTrackDuration();
        },
        onStateChange: (event) => {
          // Report the new playing state right away, not just on the next
          // periodic heartbeat, so the server's "nobody is playing" check
          // works with fresh information.
          if (hasUserStarted) {
            sendHeartbeat().catch((e) => console.error('再生状態のheartbeatに失敗しました:', e));
          }
          if (event.data === YT.PlayerState.PLAYING) {
            hasPlayedCurrentVideo = true;
            // Playing again means any suspected pause was spurious.
            dropPendingPause();
            releaseFrozenCountdown();
            disableCaptions();
            reportTrackDuration();
            handlePlayerResumed();
          }
          if (event.data === YT.PlayerState.PAUSED) {
            notePlayerPaused(false);
          }
          if (event.data === YT.PlayerState.UNSTARTED && hasPlayedCurrentVideo) {
            // stopVideo() lands here: the video was stopped by hand, which
            // must freeze the countdown just like a pause.
            notePlayerPaused(true);
          }
          if (event.data === YT.PlayerState.ENDED) {
            dropPendingPause();
            finishTrack();
          }
        }
      }
    });
  }

  function applyState(state, receivedAtMs = Date.now()) {
    current = state;

    if (pauseRequestId !== null && (state.status === 'paused' || state.request_id !== pauseRequestId)) {
      pauseRequestId = null;
    }
    if (resumeRequestId !== null && (state.status === 'playing' || state.request_id !== resumeRequestId)) {
      resumeRequestId = null;
    }
    if (pendingPause !== null && (state.status !== 'playing' || state.request_id !== pendingPause.requestId)) {
      dropPendingPause();
    }

    syncCountdown(state, receivedAtMs);
    updateInfo(state);

    if (!isActiveState(state)) {
      if (player && typeof player.stopVideo === 'function') {
        noteProgrammaticAction();
        player.stopVideo();
      }
      lastVideoId = null;
      hasPlayedCurrentVideo = false;
      reportedDurationForRequestId = null;
      return;
    }

    if (!hasUserStarted) return;

    if (!player) {
      createPlayer(state);
      return;
    }

    syncPlayerPosition(state);
  }

  async function sendPlaybackControl(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const receivedAtMs = Date.now();
    const state = await readJsonResponse(res);
    if (!res.ok) throw new Error(state.error || `Failed to update playback (${res.status})`);
    applyState(state, receivedAtMs);
    return state;
  }

  // The video stopped on this device (pause button / click / stop). Freeze
  // the local countdown immediately, but only suspect a manual pause for
  // now: the player also fires PAUSED for our own programmatic operations
  // while a track is starting, and reporting those broke autoplay.
  function notePlayerPaused(wasStopped) {
    if (!hasUserStarted || isAdvancing) return;
    if (!isActiveState(current) || current.status !== 'playing') return;
    // A video that has not played yet on this device cannot have been
    // paused by the user; its PAUSED events belong to loading / autoplay
    // negotiation and must never pause the shared state.
    if (!hasPlayedCurrentVideo) return;
    if (pauseRequestId === current.request_id) return;
    if (pendingPause?.requestId === current.request_id) return;

    frozenRemainingMs = getRemainingMs();
    deadlineMs = null;
    pendingPause = { requestId: current.request_id, wasStopped, at: Date.now() };
    updateCountdownText(getRemainingSeconds());
    nowEl.textContent = `一時停止中: ${current.title}`;

    if (pendingPauseTimer !== null) clearTimeout(pendingPauseTimer);
    pendingPauseTimer = setTimeout(promotePendingPause, PAUSE_CONFIRM_MS);
  }

  // After the confirmation window, a pause that is still in effect and was
  // not caused by our own player operations is a manual pause: share it so
  // the countdown and the video stop on every device.
  function promotePendingPause() {
    pendingPauseTimer = null;
    const pending = pendingPause;
    pendingPause = null;
    if (!pending) return;

    const abort = () => releaseFrozenCountdown();
    if (!isActiveState(current) || current.request_id !== pending.requestId || current.status !== 'playing') return;
    if (isAdvancing || pauseRequestId === pending.requestId) return;
    // We loaded / sought / started the player after this event: the pause
    // came from that operation, not from the user.
    if (lastProgrammaticActionAt > pending.at) return abort();

    const playerState = typeof player?.getPlayerState === 'function' ? player.getPlayerState() : null;
    const stillStopped = pending.wasStopped
      ? (playerState === YT.PlayerState.UNSTARTED || playerState === YT.PlayerState.CUED || playerState === YT.PlayerState.PAUSED)
      : (playerState === YT.PlayerState.PAUSED);
    if (!stillStopped) return abort();

    const positionSec = pending.wasStopped ? null : getPlayerPositionSec();

    // A pause in the last moment of the track is just the end of the video;
    // the ENDED event / countdown will advance the track.
    const durationSec = Math.min(Number(player?.getDuration?.() || 0) || current.duration_sec || MAX_PLAY_SECONDS, MAX_PLAY_SECONDS);
    if (!pending.wasStopped && positionSec !== null && positionSec >= durationSec - 0.75) return abort();

    const requestId = pending.requestId;
    pauseRequestId = requestId;

    sendPlaybackControl('/api/playback-pause', {
      request_id: requestId,
      ...(positionSec !== null ? { position_sec: positionSec } : {})
    }).catch((e) => {
      console.error('一時停止の同期に失敗しました:', e);
      if (pauseRequestId === requestId) pauseRequestId = null;
    });
  }

  // The user resumed a paused video on this device: share the resume so the
  // server re-anchors the deadline and every device continues together.
  function handlePlayerResumed() {
    if (!hasUserStarted || isAdvancing) return;
    if (!isActiveState(current) || current.status !== 'paused') return;
    if (resumeRequestId === current.request_id) return;

    const requestId = current.request_id;
    resumeRequestId = requestId;
    const positionSec = getPlayerPositionSec();

    sendPlaybackControl('/api/playback-resume', {
      request_id: requestId,
      ...(positionSec !== null ? { position_sec: positionSec } : {})
    }).catch((e) => {
      console.error('再開の同期に失敗しました:', e);
      if (resumeRequestId === requestId) resumeRequestId = null;
    });
  }

  async function reportTrackDuration() {
    if (
      !player ||
      !current?.request_id ||
      !isActiveState(current) ||
      reportedDurationForRequestId === current.request_id ||
      reportingDurationForRequestId === current.request_id
    ) return;

    const videoDuration = Number(player.getDuration?.());
    if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;

    const durationSec = Math.min(MAX_PLAY_SECONDS, Math.max(1, Math.floor(videoDuration)));
    const requestId = current.request_id;
    reportingDurationForRequestId = requestId;

    try {
      const res = await fetch('/api/playback-duration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, duration_sec: durationSec })
      });
      const receivedAtMs = Date.now();
      const state = await readJsonResponse(res);
      if (!res.ok) throw new Error(state.error || 'Failed to update playback duration');
      reportedDurationForRequestId = requestId;
      applyState(state, receivedAtMs);
    } catch (e) {
      // The player can still finish naturally even if the duration sync fails.
      console.error('曲の長さの同期に失敗しました:', e);
    } finally {
      if (reportingDurationForRequestId === requestId) {
        reportingDurationForRequestId = null;
      }
    }
  }

  async function fetchPlaybackState() {
    const res = await fetch('/api/playback-state');
    const receivedAtMs = Date.now();
    const state = await readJsonResponse(res);

    if (!res.ok) {
      throw new Error(state.error || 'Failed to fetch playback state');
    }

    applyState(state, receivedAtMs);
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
    const receivedAtMs = Date.now();
    const state = await readJsonResponse(res);

    applyState(state, receivedAtMs);

    if (!res.ok && res.status !== 404) {
      throw new Error(state.error || 'Failed to advance playback');
    }

    return state;
  }

  function startLocalCountdown() {
    clearInterval(countdownTimer);
    // Tick faster than once a second and always compute the remaining time
    // from the absolute deadline, so a throttled or late tick can only make
    // the display catch up, never drift.
    countdownTimer = setInterval(() => {
      if (!isActiveState(current)) return;

      if (isPausedState(current)) {
        updateCountdownText(getRemainingSeconds());
        return;
      }

      const remainingMs = getRemainingMs();
      updateCountdownText(getRemainingSeconds());

      if (remainingMs <= 0 && hasUserStarted) {
        finishTrack();
      }
    }, TICK_INTERVAL_MS);
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
    startHeartbeat();
    startLocalCountdown();
    startSyncLoop();

    try {
      await sendHeartbeat();
      const state = await fetchPlaybackState();
      if (state.status === 'stopped') {
        await advancePlayback();
      }
    } catch (e) {
      console.error(e);
      nowEl.textContent = '通信エラー';
    }
  }

  async function finishTrack() {

    if (!current || isAdvancing || !isActiveState(current)) return;

    isAdvancing = true;
    dropPendingPause();
    pauseRequestId = null;
    resumeRequestId = null;

    try {
      await advancePlayback();
    } catch (e) {
      console.error('次の曲への同期に失敗しました:', e);
    } finally {
      isAdvancing = false;
    }

  }

  function openConfirmModal() {

    if (!isActiveState(current)) return;
    confirmModal.hidden = false;
    confirmModal.style.display = "grid";
    closeNextDrawer();

  }

  function toggleNextDrawer() {
    const isOpen = nextDrawer.classList.toggle('is-open');
    nextDrawerToggle.setAttribute('aria-expanded', String(isOpen));
    document.getElementById('next-drawer-panel').setAttribute('aria-hidden', String(!isOpen));
  }

  function closeNextDrawer() {
    nextDrawer.classList.remove('is-open');
    nextDrawerToggle.setAttribute('aria-expanded', 'false');
    document.getElementById('next-drawer-panel').setAttribute('aria-hidden', 'true');
  }

  function closeConfirmModal() {

    confirmModal.hidden = true;
    confirmModal.style.display = "none";

  }

  fetchPlaybackState().catch(() => {
    nowEl.textContent = '同期待機中';
  });
  startSyncLoop();

  window.addEventListener('pagehide', notifyPlaybackLeave);
  window.addEventListener('beforeunload', notifyPlaybackLeave);

  startBtn.addEventListener('click', beginPlayback, { once: true });
  nextBtn.addEventListener('click', openConfirmModal);
  if (disableCaptionsBtn) {
    disableCaptionsBtn.addEventListener('click', () => {
      disableCaptions();
    });
  }
  nextDrawerToggle.addEventListener('click', toggleNextDrawer);
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
