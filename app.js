import { EventBus } from './core/event-bus.js';
import { Store } from './core/store.js';
import { BlockRegistry } from './core/block-registry.js';
import { escapeHtml } from './core/yt-core.js';

import { playerBlock } from './blocks/player-block.js';
import { playlistImporterBlock } from './blocks/playlist-importer-block.js';
import { queueBlock } from './blocks/queue-block.js';
import { partyRoomBlock } from './blocks/party-room-block.js';
import { sleepTimerBlock } from './blocks/sleep-timer-block.js';
import { cuePointsBlock } from './blocks/cue-points-block.js';

const bus = new EventBus();
const store = new Store();

// 同一句話 3 秒內只顯示一次，畫面最多疊 3 則（不會一直疊上去）
const recentToasts = new Map();
function toast(message, durationMs = 2600) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const now = Date.now();
  if (now - (recentToasts.get(message) || 0) < 3000) return;
  recentToasts.set(message, now);
  while (container.children.length >= 3) container.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

function switchTab(targetTab) {
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.tab === targetTab);
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.target === targetTab);
  });
  updateMiniPlayer();
}

function updateMiniPlayer() {
  const bar = document.getElementById('miniPlayerBar');
  const isPlayerTab = document.getElementById('tab-player')?.classList.contains('active');
  const track = store.getCurrentTrack();

  if (!bar) return;
  if (isPlayerTab || !track) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  document.getElementById('miniThumb').src = track.thumbnail || './icon.svg';
  document.getElementById('miniTitle').textContent = track.title;
  document.getElementById('miniAuthor').textContent = track.author || 'YouTube';
  document.getElementById('miniPlayBtn').textContent = store.getState().isPlaying ? '⏸' : '▶';
}

function updateTopStatus() {
  const badge = document.getElementById('topStatusBadge');
  const { room } = store.getState();
  if (!badge) return;
  if (room) {
    const roleLabel = room.role === 'host' ? '房主' : '兔友';
    badge.textContent = `派對房 ${room.code} (${roleLabel}) · ${room.members.length} 人在線`;
  } else {
    badge.textContent = '單機模式 · 積木架構';
  }
}

const registry = new BlockRegistry({
  bus,
  store,
  toast,
  switchTab
});

// 註冊前端功能積木
registry
  .register(playerBlock)
  .register(playlistImporterBlock)
  .register(queueBlock)
  .register(partyRoomBlock)
  .register(sleepTimerBlock)
  .register(cuePointsBlock);

// 渲染積木中心管理介面
function renderBlockManager(blocks) {
  const container = document.getElementById('blockManagerList');
  if (!container) return;
  container.innerHTML = '';

  for (const b of blocks) {
    const item = document.createElement('div');
    item.className = 'block-item';
    item.innerHTML = `
      <div>
        <div style="font-weight:700;font-size:14px;">${escapeHtml(b.icon)} ${escapeHtml(b.name)} <span class="muted">v${escapeHtml(b.version)}</span></div>
        <div class="muted">${escapeHtml(b.description)}</div>
      </div>
      <label class="switch" title="${b.required ? '核心積木不可停用' : '切換啟用狀態'}">
        <input type="checkbox" ${b.mounted ? 'checked' : ''} ${b.required ? 'disabled' : ''} />
        <span class="slider"></span>
      </label>
    `;
    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        registry.enable(b.id);
        toast(`已裝上「${b.name}」積木`);
      } else {
        registry.disable(b.id);
        toast(`已卸除「${b.name}」積木`);
      }
    });
    container.appendChild(item);
  }
}

// 底部導覽列事件
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.target));
});

// 迷你播放器控制
document.getElementById('miniInfoTap')?.addEventListener('click', () => switchTab('player'));
document.getElementById('miniPlayBtn')?.addEventListener('click', () => bus.emit('player:toggle'));
document.getElementById('miniNextBtn')?.addEventListener('click', () => bus.emit('player:next'));

// PWA 安裝提示
let deferredPrompt = null;
const installBtn = document.getElementById('installAppBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn?.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// 監聽狀態更新頂部列與迷你播放條
store.subscribe(() => {
  updateMiniPlayer();
  updateTopStatus();
});

registry.onChange(renderBlockManager);
registry.bootEnabledBlocks();
updateTopStatus();
updateMiniPlayer();

// 版本號：部署時會自動填上（在「積木」分頁最下面看得到，方便確認手機上是不是最新版）
const ver = document.querySelector('meta[name="app-version"]')?.content || 'dev';
const built = document.querySelector('meta[name="app-built"]')?.content || '';
const verEl = document.getElementById('appVer');
if (verEl) verEl.textContent = `版本 ${ver}${built ? ` · ${built}` : ''}`;
