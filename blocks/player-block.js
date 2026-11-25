/**
 * [積木 1] YouTube 播放器核心積木
 * 封裝 YouTube IFrame API、進度條、循環/隨機、封面模式與 Media Session 鎖屏控制
 * 播不了的歌（上傳者不開放嵌入、已刪除）會標記起來，自動換歌時跳過，全部都播不了就停下來
 */
import { loadYouTubeAPI } from '../core/yt-api.js';
import { nextIndex, needsTitle, errorReason } from '../core/yt-core.js';

function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export const playerBlock = {
  id: 'player',
  name: 'YouTube 播放核心積木',
  icon: '🎵',
  version: '1.0.0',
  description: 'YouTube IFrame 播放、進度控制、隨機/循環與手機鎖屏 Media Session 支援',
  slotId: 'slot-player',
  required: true,

  mount({ bus, store, toast, switchTab }) {
    const slot = document.getElementById('slot-player');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <div class="card-header" style="margin-bottom:8px;">
          <span class="muted" id="playerModeLabel">封面模式</span>
          <button id="toggleVideoModeBtn" class="btn btn-sm" type="button">切換 MV 畫面</button>
        </div>

        <div id="playerStage" class="player-stage audio-mode">
          <div id="yt-player-host"></div>
          <div id="coverOverlay" class="cover-overlay">
            <img id="coverArt" src="./icon.svg" alt="封面" />
            <div class="muted" id="coverHint">請至「歌單」貼上 YT 歌單或影片連結開始聽歌</div>
          </div>
        </div>

        <div class="track-meta">
          <div id="nowTitle" class="track-title">尚未播放歌曲</div>
          <div id="nowAuthor" class="track-sub">貼上 YouTube 連結或加入派對房即可開始</div>
        </div>

        <div class="progress-wrap">
          <input id="seekSlider" class="seek-slider" type="range" min="0" max="100" value="0" />
          <div class="time-row">
            <span id="timeCurrent">0:00</span>
            <span id="timeDuration">0:00</span>
          </div>
        </div>

        <div class="controls-row">
          <button id="shuffleBtn" class="icon-btn" type="button" title="隨機播放">🔀</button>
          <button id="prevBtn" class="icon-btn" type="button" title="上一首">⏮</button>
          <button id="playPauseBtn" class="icon-btn primary-circle" type="button" title="播放/暫停">▶</button>
          <button id="nextBtn" class="icon-btn" type="button" title="下一首">⏭</button>
          <button id="repeatBtn" class="icon-btn" type="button" title="循環模式">🔁</button>
        </div>

        <div class="chip-row" style="justify-content:space-between;align-items:center;">
          <button id="quickPasteNavBtn" class="btn btn-sm btn-primary" type="button">➕ 貼上 YT 歌單連結</button>
          <span class="muted" id="remoteModeBadge"></span>
        </div>
      </div>
    `;

    const coverOverlay = slot.querySelector('#coverOverlay');
    const coverArt = slot.querySelector('#coverArt');
    const coverHint = slot.querySelector('#coverHint');
    const playerStage = slot.querySelector('#playerStage');
    const toggleVideoBtn = slot.querySelector('#toggleVideoModeBtn');
    const playerModeLabel = slot.querySelector('#playerModeLabel');
    const nowTitle = slot.querySelector('#nowTitle');
    const nowAuthor = slot.querySelector('#nowAuthor');
    const seekSlider = slot.querySelector('#seekSlider');
    const timeCurrent = slot.querySelector('#timeCurrent');
    const timeDuration = slot.querySelector('#timeDuration');
    const shuffleBtn = slot.querySelector('#shuffleBtn');
    const prevBtn = slot.querySelector('#prevBtn');
    const playPauseBtn = slot.querySelector('#playPauseBtn');
    const nextBtn = slot.querySelector('#nextBtn');
    const repeatBtn = slot.querySelector('#repeatBtn');
    const remoteModeBadge = slot.querySelector('#remoteModeBadge');

    let ytPlayer = null;
    let ytReady = false;
    let loadedVideoId = null;
    let showVideo = false;
    let isSeeking = false;
    let cueEndTriggeredFor = null;
    let erroredVideoId = null;
    let skipTimer = 0;

    /** 開始播放了：這首能播（清掉「播不了」標記），歌名還沒拿到的話直接跟播放器要 */
    function rememberPlayable() {
      const track = store.getCurrentTrack();
      if (!track || !ytPlayer?.getVideoData) return;
      erroredVideoId = null;
      const patch = {};
      if (track.bad) patch.bad = false;
      if (needsTitle(track)) {
        const data = ytPlayer.getVideoData() || {};
        if (data.video_id === track.videoId && data.title) {
          patch.title = String(data.title).slice(0, 200);
          if (data.author) patch.author = String(data.author).slice(0, 100);
        }
      }
      if (Object.keys(patch).length) store.updateTrack(track.videoId, patch);
    }

    function isGuestRemoteOnly() {
      const { room } = store.getState();
      return Boolean(room && room.role === 'guest');
    }

    function getCue(track) {
      if (!track) return { startSec: 0, endSec: 0 };
      const saved = store.getState().cuePoints?.[track.videoId];
      return {
        startSec: Number(saved?.startSec ?? track.startSec ?? 0) || 0,
        endSec: Number(saved?.endSec ?? track.endSec ?? 0) || 0
      };
    }

    function updateMediaSession(track, isPlaying) {
      if (!('mediaSession' in navigator) || !track) return;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title,
          artist: track.author || 'YouTube',
          album: '派對兔 YT 播放器',
          artwork: [{ src: track.thumbnail || './icon.svg', sizes: '480x360', type: 'image/jpeg' }]
        });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      } catch {
        // Ignore unsupported browsers
      }
    }

    if ('mediaSession' in navigator) {
      const safeSet = (action, fn) => {
        try {
          navigator.mediaSession.setActionHandler(action, fn);
        } catch {
          // Ignore
        }
      };
      safeSet('play', () => bus.emit('player:toggle'));
      safeSet('pause', () => bus.emit('player:pause'));
      safeSet('previoustrack', () => bus.emit('player:prev'));
      safeSet('nexttrack', () => bus.emit('player:next'));
    }

    function renderUI() {
      const state = store.getState();
      const track = store.getCurrentTrack();
      const guestRemote = isGuestRemoteOnly();

      playPauseBtn.textContent = state.isPlaying ? '⏸' : '▶';
      shuffleBtn.classList.toggle('active-mode', state.shuffle);
      repeatBtn.classList.toggle('active-mode', state.repeatMode !== 'off');
      repeatBtn.textContent = state.repeatMode === 'one' ? '🔂' : '🔁';
      remoteModeBadge.textContent = guestRemote ? '📱 遙控模式（房主端出聲）' : '';

      if (!track) {
        nowTitle.textContent = '尚未播放歌曲';
        nowAuthor.textContent = '貼上 YouTube 連結或加入派對房即可開始';
        coverArt.src = './icon.svg';
        coverHint.textContent = '請至「歌單」貼上 YT 歌單或影片連結開始聽歌';
        coverOverlay.classList.remove('hidden');
        return;
      }

      nowTitle.textContent = track.title;
      nowAuthor.textContent = `${track.author || 'YouTube'}${track.addedBy ? ` · 點歌: ${track.addedBy}` : ''}`;
      coverArt.src = track.thumbnail || './icon.svg';
      coverHint.textContent = guestRemote
        ? '目前為房客遙控模式（音樂由房主裝置播放）'
        : state.isPlaying
          ? '播放中（封面模式，影片照常在下面播放）'
          : '已暫停（點擊 ▶ 繼續播放）';
      coverOverlay.classList.toggle('hidden', showVideo && !guestRemote);
      updateMediaSession(track, state.isPlaying);
    }

    function syncPlayerToCurrentTrack(forcePlay = false) {
      const track = store.getCurrentTrack();
      const { isPlaying } = store.getState();
      renderUI();

      if (!ytReady || !ytPlayer) return;
      if (!track || isGuestRemoteOnly()) {
        if (ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        return;
      }

      const cue = getCue(track);
      if (loadedVideoId !== track.videoId) {
        loadedVideoId = track.videoId;
        cueEndTriggeredFor = null;
        if (isPlaying || forcePlay) {
          ytPlayer.loadVideoById({ videoId: track.videoId, startSeconds: cue.startSec });
        } else {
          ytPlayer.cueVideoById({ videoId: track.videoId, startSeconds: cue.startSec });
        }
      } else if (isPlaying && ytPlayer.getPlayerState?.() !== 1 && erroredVideoId !== track.videoId) {
        // 這首剛剛報錯、正在等跳下一首：不要再叫它播
        ytPlayer.playVideo();
      } else if (!isPlaying && ytPlayer.getPlayerState?.() === 1) {
        ytPlayer.pauseVideo();
      }
    }

    function pickNextIndex(step = 1, auto = false) {
      return nextIndex(store.getState(), step, auto);
    }

    function playIndex(idx, broadcast = true) {
      const { queue } = store.getState();
      if (idx < 0 || idx >= queue.length) {
        store.setState({ isPlaying: false });
        return;
      }
      loadedVideoId = null;
      erroredVideoId = null;
      store.setState({ currentIndex: idx, isPlaying: true });
      syncPlayerToCurrentTrack(true);
      if (broadcast) bus.emit('room:playbackAction', { action: 'select', index: idx });
    }

    function nextTrack(autoEnded = false) {
      const { room } = store.getState();
      if (room && !autoEnded) {
        bus.emit('room:playbackAction', { action: 'next' });
        if (room.role === 'guest') return;
      }
      const nextIdx = pickNextIndex(1, autoEnded);
      if (nextIdx === -1) {
        store.setState({ isPlaying: false });
        const { queue } = store.getState();
        toast(queue.length && queue.every((t) => t.bad) ? '清單裡的歌都不能播，已停止' : '歌單已播放完畢');
        return;
      }
      playIndex(nextIdx, Boolean(room && room.role === 'host'));
    }

    function prevTrack() {
      const { room } = store.getState();
      if (room?.role === 'guest') {
        bus.emit('room:playbackAction', { action: 'prev' });
        return;
      }
      const prevIdx = pickNextIndex(-1);
      if (prevIdx >= 0) playIndex(prevIdx, Boolean(room));
    }

    function togglePlay() {
      const { queue, currentIndex, isPlaying, room } = store.getState();
      if (!queue.length) {
        toast('請先匯入 YouTube 歌曲或歌單');
        switchTab('playlist');
        return;
      }
      if (room?.role === 'guest') {
        bus.emit('room:playbackAction', { action: 'toggle' });
        return;
      }
      const targetIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextPlaying = !isPlaying;
      if (nextPlaying) erroredVideoId = null; // 自己按 ▶：就算之前播不了也再試一次
      store.setState({ currentIndex: targetIndex, isPlaying: nextPlaying });
      syncPlayerToCurrentTrack(nextPlaying);
      if (room) bus.emit('room:playbackAction', { isPlaying: nextPlaying, currentIndex: targetIndex });
    }

    loadYouTubeAPI().then((YT) => {
      ytPlayer = new YT.Player('yt-player-host', {
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            ytReady = true;
            syncPlayerToCurrentTrack(false);
          },
          onStateChange: (event) => {
            if (isGuestRemoteOnly()) return;
            if (event.data === YT.PlayerState.PLAYING) {
              if (!store.getState().isPlaying) store.setState({ isPlaying: true });
              rememberPlayable();
            } else if (event.data === YT.PlayerState.PAUSED) {
              if (store.getState().isPlaying) store.setState({ isPlaying: false });
            } else if (event.data === YT.PlayerState.ENDED) {
              nextTrack(true);
            }
          },
          onError: (event) => {
            if (isGuestRemoteOnly()) return;
            const track = store.getCurrentTrack();
            // YouTube 有時同一首會連續報兩次錯：同一首只處理一次
            if (!track || erroredVideoId === track.videoId) return;
            erroredVideoId = track.videoId;
            store.updateTrack(track.videoId, { bad: true });
            toast(`${errorReason(event.data)}，自動跳下一首`);
            clearTimeout(skipTimer);
            skipTimer = setTimeout(() => {
              const now = store.getCurrentTrack();
              if (now && now.videoId === erroredVideoId) nextTrack(true);
            }, 900);
          }
        }
      });
    });

    // 進度條與進切歌點檢查輪詢
    const timer = setInterval(() => {
      if (!ytReady || !ytPlayer?.getCurrentTime || isGuestRemoteOnly()) return;
      const track = store.getCurrentTrack();
      if (!track) return;

      const cur = ytPlayer.getCurrentTime() || 0;
      const dur = ytPlayer.getDuration() || 0;
      if (!isSeeking && dur > 0) {
        seekSlider.max = Math.floor(dur);
        seekSlider.value = Math.floor(cur);
        timeCurrent.textContent = formatTime(cur);
        timeDuration.textContent = formatTime(dur);
      }

      bus.emit('player:time', { currentTime: cur, duration: dur, videoId: track.videoId });

      const cue = getCue(track);
      if (cue.endSec > 0 && cur >= cue.endSec && cueEndTriggeredFor !== track.videoId) {
        cueEndTriggeredFor = track.videoId;
        nextTrack(true);
      }
    }, 500);

    // UI 事件綁定
    toggleVideoBtn.addEventListener('click', () => {
      showVideo = !showVideo;
      playerStage.classList.toggle('audio-mode', !showVideo);
      playerModeLabel.textContent = showVideo ? 'MV 影片模式' : '封面模式';
      toggleVideoBtn.textContent = showVideo ? '切換封面模式' : '切換 MV 畫面';
      renderUI();
    });

    playPauseBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', () => nextTrack(false));
    prevBtn.addEventListener('click', prevTrack);

    shuffleBtn.addEventListener('click', () => {
      const next = !store.getState().shuffle;
      store.setState({ shuffle: next });
      toast(next ? '已開啟隨機播放' : '已關閉隨機播放');
    });

    repeatBtn.addEventListener('click', () => {
      const order = ['all', 'one', 'off'];
      const cur = store.getState().repeatMode;
      const next = order[(order.indexOf(cur) + 1) % order.length];
      store.setState({ repeatMode: next });
      const label = { all: '全部循環', one: '單曲循環', off: '不循環' }[next];
      toast(`循環模式：${label}`);
    });

    seekSlider.addEventListener('input', () => {
      isSeeking = true;
      timeCurrent.textContent = formatTime(seekSlider.value);
    });
    seekSlider.addEventListener('change', () => {
      isSeeking = false;
      ytPlayer?.seekTo?.(Number(seekSlider.value), true);
    });

    slot.querySelector('#quickPasteNavBtn').addEventListener('click', () => switchTab('playlist'));

    const unsubStore = store.subscribe(() => syncPlayerToCurrentTrack(false));
    const unsubs = [
      unsubStore,
      bus.on('player:toggle', togglePlay),
      bus.on('player:pause', () => {
        store.setState({ isPlaying: false });
        ytPlayer?.pauseVideo?.();
      }),
      bus.on('player:next', () => nextTrack(false)),
      bus.on('player:prev', prevTrack),
      bus.on('player:playIndex', ({ index }) => playIndex(index)),
      bus.on('player:seek', ({ seconds }) => ytPlayer?.seekTo?.(seconds, true))
    ];

    renderUI();

    return () => {
      clearInterval(timer);
      clearTimeout(skipTimer);
      unsubs.forEach((u) => u && u());
      ytPlayer?.destroy?.();
    };
  }
};
