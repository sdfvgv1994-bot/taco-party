/**
 * [積木 6] 進歌點 / 切歌點設定積木（派對兔特色功能）
 * 可針對單曲設定從第幾秒開始播（跳過前奏/廣告）與第幾秒自動切歌（跳過片尾）
 */
export const cuePointsBlock = {
  id: 'cue-points',
  name: '進歌 / 切歌點積木',
  icon: '✂️',
  version: '1.0.0',
  description: '自訂目前歌曲的進歌秒數與切歌秒數，自動略過片頭片尾',
  slotId: 'slot-cue-points',
  required: false,

  mount({ bus, store, toast }) {
    const slot = document.getElementById('slot-cue-points');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <div class="card-header" style="margin-bottom:6px;">
          <h3>✂️ 進歌 / 切歌點</h3>
          <span id="cueTrackHint" class="muted">目前無歌曲</span>
        </div>
        <div class="input-row">
          <input id="cueStartInput" class="input" type="number" min="0" placeholder="進歌秒數 (例 15)" />
          <input id="cueEndInput" class="input" type="number" min="0" placeholder="切歌秒數 (0=播完)" />
        </div>
        <div class="chip-row" style="justify-content:space-between;">
          <div style="display:flex;gap:6px;">
            <button id="markStartNowBtn" class="btn btn-sm" type="button">設現在為進歌點</button>
            <button id="markEndNowBtn" class="btn btn-sm" type="button">設現在為切歌點</button>
          </div>
          <button id="saveCueBtn" class="btn btn-sm btn-primary" type="button">套用</button>
        </div>
      </div>
    `;

    const hintEl = slot.querySelector('#cueTrackHint');
    const startInput = slot.querySelector('#cueStartInput');
    const endInput = slot.querySelector('#cueEndInput');
    let latestTime = 0;

    function syncInputs() {
      const track = store.getCurrentTrack();
      if (!track) {
        hintEl.textContent = '目前無歌曲';
        startInput.value = '';
        endInput.value = '';
        return;
      }
      hintEl.textContent = track.title.slice(0, 18) + (track.title.length > 18 ? '...' : '');
      const cue = store.getState().cuePoints?.[track.videoId] || { startSec: 0, endSec: 0 };
      startInput.value = cue.startSec ? String(cue.startSec) : '';
      endInput.value = cue.endSec ? String(cue.endSec) : '';
    }

    slot.querySelector('#markStartNowBtn').addEventListener('click', () => {
      startInput.value = String(Math.floor(latestTime));
    });
    slot.querySelector('#markEndNowBtn').addEventListener('click', () => {
      endInput.value = String(Math.floor(latestTime));
    });

    slot.querySelector('#saveCueBtn').addEventListener('click', () => {
      const track = store.getCurrentTrack();
      if (!track) {
        toast('請先播放一首歌曲');
        return;
      }
      const startSec = Math.max(0, Number(startInput.value) || 0);
      const endSec = Math.max(0, Number(endInput.value) || 0);
      if (endSec > 0 && endSec <= startSec) {
        toast('切歌秒數必須大於進歌秒數');
        return;
      }
      const nextCues = {
        ...store.getState().cuePoints,
        [track.videoId]: { startSec, endSec }
      };
      store.setState({ cuePoints: nextCues });
      toast(`已設定進歌 ${startSec}s / 切歌 ${endSec || '結尾'}s`);
    });

    const unsubStore = store.subscribe(syncInputs);
    const unsubTime = bus.on('player:time', ({ currentTime }) => {
      latestTime = currentTime || 0;
    });
    syncInputs();

    return () => {
      unsubStore();
      unsubTime();
    };
  }
};
