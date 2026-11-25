import { addToQueue, YT_ID, placeholderTitle } from './yt-core.js';

const STORAGE_KEY = 'taco_party_state_v1';

const DEFAULT_STATE = {
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  repeatMode: 'all', // 'all' | 'one' | 'off'
  shuffle: false,
  savedPlaylists: [],
  cuePoints: {}, // { [videoId]: { startSec, endSec } }
  room: null, // 派對房（下一版用 Firebase 做）：{ code, name, role: 'host'|'guest', memberName, members }
  enabledBlocks: {
    player: true,
    'playlist-importer': true,
    queue: true,
    'party-room': true,
    'sleep-timer': true,
    'cue-points': true
  }
};

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const state = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      isPlaying: false,
      room: null, // 派對房是即時連線，重開時要重新加入
      enabledBlocks: {
        ...DEFAULT_STATE.enabledBlocks,
        ...(parsed.enabledBlocks || {})
      }
    };
    // 存檔裡壞掉的歌（不是物件、沒有影片代號）直接丟掉，不要讓整個 App 打不開
    const okTrack = (t) => t && typeof t === 'object' && typeof t.videoId === 'string' && YT_ID.test(t.videoId);
    const cleanTracks = (list) =>
      (Array.isArray(list) ? list : []).filter(okTrack).map((t) => ({
        ...t,
        id: String(t.id || Math.random().toString(36).slice(2, 11)),
        title: t.title ? String(t.title) : placeholderTitle(t.videoId),
        author: String(t.author || 'YouTube')
      }));
    state.queue = cleanTracks(state.queue);
    state.savedPlaylists = (Array.isArray(state.savedPlaylists) ? state.savedPlaylists : [])
      .filter((pl) => pl && typeof pl === 'object')
      .map((pl) => ({ ...pl, name: String(pl.name || '未命名歌單'), tracks: cleanTracks(pl.tracks) }));
    if (!state.cuePoints || typeof state.cuePoints !== 'object') state.cuePoints = {};
    if (!(state.currentIndex >= -1 && state.currentIndex < state.queue.length)) {
      state.currentIndex = state.queue.length ? 0 : -1;
    }
    return state;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export class Store {
  constructor() {
    this.state = loadPersistedState();
    this.subscribers = new Set();
  }

  getState() {
    return this.state;
  }

  getCurrentTrack() {
    const { queue, currentIndex } = this.state;
    if (currentIndex < 0 || currentIndex >= queue.length) return null;
    return queue[currentIndex];
  }

  setState(updater) {
    const patch = typeof updater === 'function' ? updater(this.state) : updater;
    this.state = { ...this.state, ...patch };
    this._persist();
    for (const fn of this.subscribers) {
      fn(this.state);
    }
  }

  /** 加歌到待播清單（同一支影片不重複加）；回傳 { added, skipped } */
  addTracks(tracks, playNext = false) {
    const { queue, currentIndex } = this.state;
    const res = addToQueue(queue, currentIndex, tracks, playNext);
    if (res.added) this.setState({ queue: res.queue, currentIndex: res.currentIndex });
    return { added: res.added, skipped: res.skipped };
  }

  /** 更新待播清單裡某支影片的資料（例如補上歌名、標記播不了） */
  updateTrack(videoId, patch) {
    let changed = false;
    const queue = this.state.queue.map((t) => {
      if (t.videoId !== videoId) return t;
      changed = true;
      return { ...t, ...patch };
    });
    if (changed) this.setState({ queue });
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  _persist() {
    try {
      const toSave = {
        queue: this.state.queue,
        currentIndex: this.state.currentIndex,
        repeatMode: this.state.repeatMode,
        shuffle: this.state.shuffle,
        savedPlaylists: this.state.savedPlaylists,
        cuePoints: this.state.cuePoints,
        enabledBlocks: this.state.enabledBlocks
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // 存不了（空間滿、無痕模式）就算了
    }
  }
}
