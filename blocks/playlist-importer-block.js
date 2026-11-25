/**
 * [積木 2] YT 連結／歌單匯入積木
 * 在手機瀏覽器裡直接解析（不需要電腦伺服器）：
 * - 影片、Shorts、分享連結、YouTube Music：直接加入
 * - 播放清單：用畫面外、不播放的 YouTube 官方播放器讀出清單裡的影片
 * - 歌名：問 YouTube 的 oEmbed（官方公開資料）
 */
import { parseAll, makeTrack, needsTitle } from '../core/yt-core.js';
import { resolvePlaylist, fetchVideoInfo } from '../core/yt-api.js';

export const playlistImporterBlock = {
  id: 'playlist-importer',
  name: 'YT 歌單連結匯入積木',
  icon: '🔗',
  version: '2.0.0',
  description: '貼上 YouTube 單曲或完整歌單連結（可以一次貼很多個），自動抓歌名加入隊列',
  slotId: 'slot-importer',
  required: false,

  mount({ store, bus, toast, switchTab }) {
    const slot = document.getElementById('slot-importer');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <h2>貼上 YouTube 歌單或影片連結</h2>
        <p class="muted">支援 playlist?list=...、watch?v=...、youtu.be/...、Shorts 與 YouTube Music 連結，可以一次貼很多個</p>

        <div class="input-row">
          <textarea id="ytUrlInput" class="input" rows="2" placeholder="在此貼上 YouTube 影片或歌單連結..."></textarea>
          <button id="pasteClipBtn" class="btn" type="button">貼上</button>
        </div>

        <div class="chip-row" style="align-items:center;justify-content:space-between;">
          <label class="checkbox-label" style="margin-top:0;">
            <input id="playNextCheck" type="checkbox" />
            插播到下一首
          </label>
          <div style="display:flex;gap:8px;">
            <button id="importSingleBtn" class="btn btn-sm" type="button">只加此首</button>
            <button id="importAutoBtn" class="btn btn-sm btn-primary" type="button">匯入歌單 / 加入</button>
          </div>
        </div>
        <p id="importMsg" class="muted import-msg" aria-live="polite"></p>
      </div>
    `;

    const input = slot.querySelector('#ytUrlInput');
    const pasteBtn = slot.querySelector('#pasteClipBtn');
    const playNextCheck = slot.querySelector('#playNextCheck');
    const importAutoBtn = slot.querySelector('#importAutoBtn');
    const importSingleBtn = slot.querySelector('#importSingleBtn');
    const msgEl = slot.querySelector('#importMsg');
    let alive = true;

    function say(text, isError = false) {
      msgEl.textContent = text;
      msgEl.classList.toggle('error', isError);
    }

    /** 把待播清單裡還沒有歌名的歌，一首一首去問歌名（問到就更新畫面） */
    let titleBusy = false;
    async function fillTitles() {
      if (titleBusy) return;
      titleBusy = true;
      try {
        const asked = new Set();
        for (;;) {
          if (!alive) return;
          const track = store.getState().queue.find((t) => needsTitle(t) && !t.noTitle && !asked.has(t.videoId));
          if (!track) return;
          asked.add(track.videoId);
          const info = await fetchVideoInfo(track.videoId);
          if (!alive) return;
          if (info && info.title) store.updateTrack(track.videoId, { title: info.title, author: info.author || 'YouTube' });
          else if (info && info.bad) store.updateTrack(track.videoId, { bad: true, noTitle: true });
          else store.updateTrack(track.videoId, { noTitle: true });
        }
      } finally {
        titleBusy = false;
      }
    }

    async function importUrl(mode) {
      const raw = input.value.trim();
      if (!raw) {
        say('請先貼上 YouTube 連結', true);
        return;
      }
      const found = parseAll(raw);
      if (!found.length) {
        say('看不懂這個連結：請貼 YouTube 影片或播放清單的網址', true);
        return;
      }

      const prevText = importAutoBtn.textContent;
      importAutoBtn.disabled = true;
      importSingleBtn.disabled = true;
      importAutoBtn.textContent = '解析中...';

      try {
        const playNext = playNextCheck.checked;
        const videoIds = [];
        const lists = [];
        let mixCount = 0;
        let listOnly = 0;
        for (const r of found) {
          if (r.mix) mixCount++;
          if (mode === 'single') {
            if (r.video) videoIds.push(r.video);
            else listOnly++;
          } else if (r.list) lists.push(r.list);
          else if (r.video) videoIds.push(r.video);
        }

        const notes = [];
        let added = 0;
        let skipped = 0;
        const addIds = (ids) => {
          const res = store.addTracks(ids.map((id) => makeTrack(id)), playNext);
          added += res.added;
          skipped += res.skipped;
        };

        if (videoIds.length) addIds(videoIds);
        if (lists.length) say(`正在讀取 ${lists.length} 份播放清單…`);
        for (const listId of lists) {
          const ids = await resolvePlaylist(listId);
          if (!alive) return;
          if (ids.length) addIds(ids);
          else notes.push('有一份播放清單讀不到（可能是私人清單）');
        }
        if (mixCount) notes.push('「自動合輯」類的清單讀不到，只加入連結裡那一首');
        if (listOnly) notes.push('播放清單連結請按「匯入歌單 / 加入」');

        let head;
        if (added) head = `已加入 ${added} 首`;
        else if (skipped) head = '這些歌已經在清單裡了';
        else head = '沒有加入任何歌';
        if (added && skipped) head += `（${skipped} 首本來就有）`;
        const text = [head, ...notes].join('；');
        say(text, !added);
        toast(text);

        if (added) {
          input.value = '';
          if (playNext) playNextCheck.checked = false;
          fillTitles();
        }
      } catch (err) {
        say('解析連結失敗：' + (err && err.message ? err.message : '請再試一次'), true);
      } finally {
        importAutoBtn.disabled = false;
        importSingleBtn.disabled = false;
        importAutoBtn.textContent = prevText;
      }
    }

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          input.value = text.trim();
          say('已貼上剪貼簿內容');
        } else {
          say('剪貼簿目前是空的', true);
        }
      } catch {
        say('瀏覽器不給讀剪貼簿，請長按輸入框手動貼上', true);
        input.focus();
      }
    });

    importAutoBtn.addEventListener('click', () => importUrl('auto'));
    importSingleBtn.addEventListener('click', () => importUrl('single'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        importUrl('auto');
      }
    });

    const unsubSwitch = bus.on('importer:focus', () => {
      switchTab('playlist');
      input.focus();
    });

    // 上次還沒問到歌名的歌（例如問到一半關掉 App），開啟時補問
    fillTitles();

    return () => {
      alive = false;
      unsubSwitch();
    };
  }
};
