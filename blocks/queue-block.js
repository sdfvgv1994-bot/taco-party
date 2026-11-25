/**
 * [積木 3] 播放隊列 & 我的收藏歌單積木
 */
import { escapeHtml } from '../core/yt-core.js';

function makeTrackId() {
  return Math.random().toString(36).slice(2, 11);
}

export const queueBlock = {
  id: 'queue',
  name: '待播清單與收藏歌單積木',
  icon: '📋',
  version: '1.0.0',
  description: '管理待播歌曲順序、置頂插播、移除歌曲與儲存個人常用歌單',
  slotId: 'slot-queue',
  required: false,

  mount({ bus, store, toast, switchTab }) {
    const slot = document.getElementById('slot-queue');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>待播清單 (<span id="queueCount">0</span>)</h2>
            <p class="muted">點擊歌曲立即播放，或儲存成常用歌單</p>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="savePlaylistBtn" class="btn btn-sm" type="button">💾 存成歌單</button>
            <button id="clearQueueBtn" class="btn btn-sm btn-danger" type="button">清空</button>
          </div>
        </div>
        <div id="queueList" class="queue-list"></div>
      </div>

      <div class="card">
        <h3>我的收藏歌單</h3>
        <p class="muted">儲存在手機本機，點一下就加進待播清單</p>
        <div id="savedPlaylistsList" class="queue-list"></div>
      </div>
    `;

    const queueCount = slot.querySelector('#queueCount');
    const queueList = slot.querySelector('#queueList');
    const savedList = slot.querySelector('#savedPlaylistsList');

    function render() {
      const { queue, currentIndex, savedPlaylists } = store.getState();
      queueCount.textContent = String(queue.length);

      if (!queue.length) {
        queueList.innerHTML = '<p class="muted">目前沒有待播歌曲，請在上方貼上 YouTube 連結。</p>';
      } else {
        queueList.innerHTML = queue
          .map(
            (t, idx) => `
          <div class="queue-item ${idx === currentIndex ? 'current' : ''} ${t.bad ? 'bad' : ''}">
            <img class="queue-thumb" src="${escapeHtml(t.thumbnail || './icon.svg')}" alt="" loading="lazy" />
            <div class="queue-info" data-play-idx="${idx}">
              <div class="queue-title">${idx === currentIndex ? '▶ ' : ''}${escapeHtml(t.title)}</div>
              <div class="queue-meta">${t.bad ? '<span class="bad-tag">無法播放（點一下可再試）</span> · ' : ''}${escapeHtml(t.author || 'YouTube')}${t.duration ? ` · ${escapeHtml(t.duration)}` : ''}${t.addedBy ? ` · ${escapeHtml(t.addedBy)}` : ''}</div>
            </div>
            <div class="queue-actions">
              <button class="btn btn-sm btn-danger" data-del-idx="${idx}" data-del-id="${escapeHtml(t.id)}" type="button" aria-label="移除這首">✕</button>
            </div>
          </div>`
          )
          .join('');
      }

      if (!savedPlaylists.length) {
        savedList.innerHTML = '<p class="muted">尚未收藏任何歌單。匯入歌單後可按上方「💾 存成歌單」。</p>';
      } else {
        savedList.innerHTML = savedPlaylists
          .map(
            (pl, idx) => `
          <div class="queue-item">
            <div class="queue-info" data-load-pl="${idx}">
              <div class="queue-title">🎶 ${escapeHtml(pl.name)}</div>
              <div class="queue-meta">${pl.tracks.length} 首歌曲 · 點一下加進待播清單</div>
            </div>
            <div class="queue-actions">
              <button class="btn btn-sm btn-primary" data-load-pl="${idx}" type="button">載入</button>
              <button class="btn btn-sm btn-danger" data-del-pl="${idx}" type="button">✕</button>
            </div>
          </div>`
          )
          .join('');
      }
    }

    function addTracksLocal({ tracks, playNext = false }) {
      const { room } = store.getState();
      if (room) {
        // 在派對房內交由 party-room-block 同步
        bus.emit('room:addTracks', { tracks, playNext });
        return { added: 0, skipped: 0 };
      }
      return store.addTracks(tracks, playNext);
    }

    queueList.addEventListener('click', (e) => {
      const playEl = e.target.closest('[data-play-idx]');
      if (playEl) {
        const idx = Number(playEl.dataset.playIdx);
        bus.emit('player:playIndex', { index: idx });
        switchTab('player');
        return;
      }

      const delEl = e.target.closest('[data-del-idx]');
      if (delEl) {
        const idx = Number(delEl.dataset.delIdx);
        const itemId = delEl.dataset.delId;
        const { queue, currentIndex, room } = store.getState();
        if (room) {
          bus.emit('room:removeTrack', { id: itemId });
          return;
        }
        const nextQueue = queue.filter((_, i) => i !== idx);
        let nextIndex = currentIndex;
        if (!nextQueue.length) nextIndex = -1;
        else if (idx < currentIndex) nextIndex = currentIndex - 1;
        else if (idx === currentIndex && currentIndex >= nextQueue.length) nextIndex = 0;

        store.setState({
          queue: nextQueue,
          currentIndex: nextIndex,
          isPlaying: nextQueue.length ? store.getState().isPlaying : false
        });
      }
    });

    savedList.addEventListener('click', (e) => {
      const loadEl = e.target.closest('[data-load-pl]');
      if (loadEl) {
        const pl = store.getState().savedPlaylists[Number(loadEl.dataset.loadPl)];
        if (!pl) return;
        const res = addTracksLocal({ tracks: pl.tracks });
        toast(
          res.added
            ? `已載入歌單「${pl.name}」：加入 ${res.added} 首${res.skipped ? `（${res.skipped} 首本來就有）` : ''}`
            : `「${pl.name}」裡的歌都已經在待播清單了`
        );
        return;
      }
      const delEl = e.target.closest('[data-del-pl]');
      if (delEl) {
        const idx = Number(delEl.dataset.delPl);
        const pl = store.getState().savedPlaylists[idx];
        if (!pl || !confirm(`確定要刪除收藏歌單「${pl.name}」嗎？`)) return;
        const nextSaved = store.getState().savedPlaylists.filter((_, i) => i !== idx);
        store.setState({ savedPlaylists: nextSaved });
        toast('已刪除收藏歌單');
      }
    });

    slot.querySelector('#savePlaylistBtn').addEventListener('click', () => {
      const { queue, savedPlaylists } = store.getState();
      if (!queue.length) {
        toast('目前待播清單是空的');
        return;
      }
      const name = prompt('請輸入要儲存的歌單名稱：', `我的歌單 ${savedPlaylists.length + 1}`);
      if (!name?.trim()) return;
      store.setState({
        savedPlaylists: [
          { id: makeTrackId(), name: name.trim(), tracks: queue, createdAt: Date.now() },
          ...savedPlaylists
        ]
      });
      toast(`已儲存「${name.trim()}」`);
    });

    slot.querySelector('#clearQueueBtn').addEventListener('click', () => {
      if (store.getState().room) {
        toast('派對房模式請逐首移除或離開房間');
        return;
      }
      const n = store.getState().queue.length;
      if (!n || !confirm(`確定要清空待播清單（${n} 首）嗎？`)) return;
      store.setState({ queue: [], currentIndex: -1, isPlaying: false });
      toast('已清空待播清單');
    });

    const unsubStore = store.subscribe(render);
    const unsubAdd = bus.on('tracks:add', addTracksLocal);
    render();

    return () => {
      unsubStore();
      unsubAdd();
    };
  }
};

