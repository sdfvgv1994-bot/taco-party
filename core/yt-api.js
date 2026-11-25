/**
 * 載入 YouTube IFrame Player API（官方嵌入播放器）；播放器和歌單解析共用，只載一次。
 * 網路不穩載不到時（script 出錯或 15 秒沒好）會失敗，下次呼叫會重新載一次。
 */
export function loadYouTubeAPI(timeoutMs = 15000) {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!window.__ytApiPromise) {
    window.__ytApiPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      const fail = (why) => {
        clearTimeout(timer);
        tag.remove();
        window.__ytApiPromise = null; // 讓下次可以重載
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('YouTube 播放器載入逾時'), timeoutMs);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        if (typeof prev === 'function') prev();
        resolve(window.YT);
      };
      tag.onerror = () => fail('YouTube 播放器載入失敗');
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
    resolverPromise.catch(() => {
      resolverPromise = null; // 載不到：下次再試
    });
  }
  return resolverPromise;
}

let busy = Promise.resolve();
/** 讀不到（私人清單、網路不穩、播放器載不到）時，最多等 timeoutMs 就回傳空陣列，不會卡住 */
export function resolvePlaylist(listId, timeoutMs = 12000) {
  // 一次只讀一份清單，排隊進行
  const job = busy.then(
    () =>
      new Promise((resolve) => {
        let done = false;
        let onState = null;
        let listeners = null;
        const finish = (ids) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (listeners && onState) listeners.delete(onState);
          resolve(ids);
        };
        // 逾時包住整段（包含等播放器載入）
        const timer = setTimeout(() => finish([]), timeoutMs);
        getResolver().then(
          (r) => {
            if (done) return;
            listeners = r.listeners;
            onState = (e) => {
              if (e.data !== window.YT.PlayerState.CUED) return;
              const ids = r.player.getPlaylist() || [];
              if (ids.length) finish(ids);
            };
            listeners.add(onState);
            r.player.cuePlaylist({ listType: 'playlist', list: listId });
          },
          () => finish([])
        );
      })
  );
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
