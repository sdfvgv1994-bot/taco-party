/**
 * taco 派對兔：不碰畫面的規則（解析 YouTube 連結、下一首是哪首），網頁和測試共用。
 * 歌曲一律用 YouTube 官方嵌入播放器播放，不下載任何影音。
 */
export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const YT_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];
// 自動合輯（RD）、上傳的影片（UL）、喜歡的影片（LL）、稍後觀看（WL）：嵌入播放器讀不到
const UNREADABLE_LIST = /^(RD|UL|LL|WL)/;

/**
 * 一個連結 → { video?, list?, mix? }；看不懂就回 null。
 * 接受影片、Shorts、播放清單、分享連結、YouTube Music 或 11 碼影片代號。
 * mix = true 代表連結裡有清單，但是是讀不到的那種（例如自動合輯）。
 */
export function parseYouTube(text) {
  text = String(text || '').trim();
  if (!text) return null;
  if (YT_ID.test(text)) return { video: text };
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  if (!YT_HOSTS.includes(host)) return null;

  let video = null;
  const list = u.searchParams.get('list');
  if (host === 'youtu.be') video = u.pathname.slice(1).split('/')[0];
  else if (u.pathname === '/watch') video = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    if (m) video = m[1];
  }

  const r = {};
  if (video && YT_ID.test(video)) r.video = video;
  if (list && YT_LIST.test(list)) {
    if (UNREADABLE_LIST.test(list)) r.mix = true;
    else r.list = list;
  }
  return r.video || r.list ? r : null;
}

/** 一段文字裡可能貼了好幾個連結（或混著別的字）：全部找出來 */
export function parseAll(text) {
  const out = [];
  text = String(text || '');
  const tokens =
    text.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[\w\-./?=&%#:+~]+/gi) || [];
  // 單獨一行的 11 碼影片代號（全是小寫英文字的不算，免得把一般單字當成影片）
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (YT_ID.test(line) && !/^[a-z]+$/.test(line)) tokens.push(line);
  }
  for (const t of tokens) {
    const r = parseYouTube(t.replace(/[.,:]+$/, ''));
    if (r) out.push(r);
  }
  return out;
}

/** 影片代號 → 一首歌的資料（還沒拿到歌名時先放暫時的名字） */
export function makeTrack(videoId, extra = {}) {
  return {
    id: extra.id || Math.random().toString(36).slice(2, 11),
    videoId,
    title: extra.title || placeholderTitle(videoId),
    author: extra.author || 'YouTube',
    duration: extra.duration || '',
    thumbnail: extra.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    addedBy: extra.addedBy || '本機',
    bad: Boolean(extra.bad)
  };
}

export function placeholderTitle(videoId) {
  return `YouTube 影片 (${videoId})`;
}

/** 歌名還是暫時的名字嗎？（是的話之後要去問歌名） */
export function needsTitle(track) {
  return !track.title || track.title === placeholderTitle(track.videoId);
}

/**
 * 把新歌加進待播清單：已經在清單裡的（同一支影片）不重複加。
 * playNext = 插播到正在播的下一首。回傳 { queue, currentIndex, added, skipped }。
 */
export function addToQueue(queue, currentIndex, tracks, playNext = false) {
  const have = new Set(queue.map((t) => t.videoId));
  const fresh = [];
  let skipped = 0;
  for (const t of tracks) {
    if (!t || !YT_ID.test(t.videoId || '')) continue;
    if (have.has(t.videoId)) {
      skipped++;
      continue;
    }
    have.add(t.videoId);
    fresh.push(t);
  }
  const next = [...queue];
  if (playNext && next.length && currentIndex >= 0) next.splice(currentIndex + 1, 0, ...fresh);
  else next.push(...fresh);
  return {
    queue: next,
    currentIndex: queue.length === 0 && fresh.length ? 0 : currentIndex,
    added: fresh.length,
    skipped
  };
}

/**
 * 下一首是哪一首。
 * step = 1 下一首、-1 上一首；auto = 播完（或播不了）自動換歌。
 * 自動換歌時會跳過播不了的歌（bad）；全部都播不了就回 -1（停下來，不會一直重試）。
 * 手動按上一首／下一首一定會繞回頭；自動換歌遇到「不循環」播到最後就停。
 */
export function nextIndex(state, step = 1, auto = false, rand = Math.random) {
  const { queue, currentIndex: cur, shuffle, repeatMode } = state;
  const n = queue.length;
  if (!n) return -1;
  const ok = (i) => !auto || !queue[i].bad;

  if (auto && repeatMode === 'one' && cur >= 0 && cur < n && !queue[cur].bad) return cur;

  if (shuffle && n > 1) {
    const pool = [];
    for (let i = 0; i < n; i++) if (i !== cur && ok(i)) pool.push(i);
    if (!pool.length) {
      // 只剩正在播的這首能播：跟不開隨機時一樣，全部循環就重播它
      if (auto && repeatMode === 'all' && cur >= 0 && cur < n && !queue[cur].bad) return cur;
      return -1;
    }
    return pool[Math.floor(rand() * pool.length)];
  }

  let p = cur;
  for (let tries = 0; tries < n; tries++) {
    p += step;
    if (p >= n) {
      if (auto && repeatMode === 'off') return -1;
      p = 0;
    }
    if (p < 0) p = n - 1;
    if (ok(p)) return p;
  }
  return -1;
}

/** YouTube 播放器的錯誤代碼 → 給人看的原因 */
export function errorReason(code) {
  if (code === 100) return '這首影片已被刪除或設為私人';
  if (code === 101 || code === 150) return '上傳者不開放在其他網站播放';
  if (code === 153) return '播放器設定有問題（重新整理再試）';
  if (code === 2) return '影片代號有誤';
  return '這首播放失敗';
}

/** 這個錯誤是不是「歌本身播不了」（要標記起來，之後自動換歌跳過）；其他錯誤可能只是暫時的，不標記 */
export function isSongError(code) {
  return code === 100 || code === 101 || code === 150 || code === 2;
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
