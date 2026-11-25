/** 載入 YouTube IFrame Player API（官方嵌入播放器）；播放器和歌單解析共用，只載一次 */
export function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!window.__ytApiPromise) {
    window.__ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }
  return window.__ytApiPromise;
}

/**
 * 播放清單 → 影片代號清單：用另一個（不播放、放在畫面外的）YouTube 播放器載入清單，再問它裡面有哪些影片。
 * 讀不到（私人清單、網路問題）時 12 秒後回傳空陣列。
 */
let resolverPromise = null;
function getResolver() {
  if (!resolverPromise) {
    resolverPromise = loadYouTubeAPI().then(
      (YT) =>
        new Promise((resolve) => {
          const box = document.createElement('div');
          box.style.cssText = 'position:fixed;left:-400px;top:0;width:200px;height:200px;opacity:0;pointer-events:none';
          box.setAttribute('aria-hidden', 'true');
          const host = document.createElement('div');
          host.id = 'ytResolverHost';
          box.appendChild(host);
          document.body.appendChild(box);
          const listeners = new Set();
          const player = new YT.Player(host.id, {
            width: 200,
            height: 200,
            playerVars: { origin: window.location.origin },
            events: {
              onReady: () => resolve({ player, listeners }),
              onStateChange: (e) => listeners.forEach((fn) => fn(e))
            }
          });
        })
    );
  }
  return resolverPromise;
}

let busy = Promise.resolve();
export function resolvePlaylist(listId, timeoutMs = 12000) {
  // 一次只讀一份清單，排隊進行
  const job = busy.then(async () => {
    const { player, listeners } = await getResolver();
    return await new Promise((resolve) => {
      const finish = (ids) => {
        clearTimeout(timer);
        listeners.delete(onState);
        resolve(ids);
      };
      const onState = (e) => {
        if (e.data !== window.YT.PlayerState.CUED) return;
        const ids = player.getPlaylist() || [];
        if (ids.length) finish(ids);
      };
      const timer = setTimeout(() => finish([]), timeoutMs);
      listeners.add(onState);
      player.cuePlaylist({ listType: 'playlist', list: listId });
    });
  });
  busy = job.catch(() => {});
  return job;
}

/**
 * 問 YouTube 的 oEmbed（官方公開資料）拿歌名和頻道名。
 * 回傳 { title, author } 、{ bad: true }（上傳者不開放嵌入）或 null（問不到）。
 */
export async function fetchVideoInfo(videoId) {
  try {
    const url =
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      return { title: String(d.title || '').slice(0, 200), author: String(d.author_name || '').slice(0, 100) };
    }
    if (r.status === 401 || r.status === 403) return { bad: true };
    return null;
  } catch {
    return null;
  }
}
