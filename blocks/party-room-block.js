/**
 * [積木 4] 派對房共聽積木（準備中）
 * 舊版靠家裡電腦的 Python 伺服器同步；這個網站放在 GitHub Pages 上沒有伺服器，
 * 下一版改用 Firebase 即時資料庫同步，到時候朋友不用連同一個 Wi-Fi 也能一起點歌。
 */
export const partyRoomBlock = {
  id: 'party-room',
  name: '派對房共聽積木',
  icon: '🐰',
  version: '2.0.0-準備中',
  description: '房主開房播歌，朋友輸入房號一起點歌切歌（下一版用 Firebase 上線）',
  slotId: 'slot-party-room',
  required: false,

  mount({ switchTab }) {
    const slot = document.getElementById('slot-party-room');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <h2>🐰 派對房（準備中）</h2>
        <p class="muted">
          派對房下一版會改用 Firebase 即時同步：房主開房播歌，朋友輸入房號就能一起點歌、插播、切歌，
          不用連同一個 Wi-Fi，出門在外也能用。
        </p>
        <p class="muted">現在可以先用「歌單」分頁貼上 YouTube 連結，自己聽歌。</p>
        <div class="input-row">
          <button id="partyGoPlaylistBtn" class="btn btn-primary" style="flex:1;" type="button">📋 去貼歌單</button>
        </div>
      </div>
    `;

    const btn = slot.querySelector('#partyGoPlaylistBtn');
    const go = () => switchTab('playlist');
    btn.addEventListener('click', go);
    return () => btn.removeEventListener('click', go);
  }
};
