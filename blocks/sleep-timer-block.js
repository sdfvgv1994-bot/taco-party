/**
 * [積木 5] 睡眠定時器積木
 */
export const sleepTimerBlock = {
  id: 'sleep-timer',
  name: '睡眠定時器積木',
  icon: '🌙',
  version: '1.0.0',
  description: '睡前聽歌倒數計時，時間一到自動暫停播放',
  slotId: 'slot-sleep-timer',
  required: false,

  mount({ bus, toast }) {
    const slot = document.getElementById('slot-sleep-timer');
    if (!slot) return;

    slot.innerHTML = `
      <div class="card">
        <div class="card-header" style="margin-bottom:4px;">
          <h3>🌙 睡眠定時器</h3>
          <span id="sleepCountdown" class="muted">未設定</span>
        </div>
        <div class="chip-row">
          <button class="chip" data-mins="15" type="button">15 分</button>
          <button class="chip" data-mins="30" type="button">30 分</button>
          <button class="chip" data-mins="45" type="button">45 分</button>
          <button class="chip" data-mins="60" type="button">60 分</button>
          <button id="cancelSleepBtn" class="chip hidden" type="button">取消定時</button>
        </div>
      </div>
    `;

    const countdownEl = slot.querySelector('#sleepCountdown');
    const cancelBtn = slot.querySelector('#cancelSleepBtn');
    let remainingSec = 0;
    let intervalId = null;

    function updateLabel() {
      if (remainingSec <= 0) {
        countdownEl.textContent = '未設定';
        cancelBtn.classList.add('hidden');
        return;
      }
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      countdownEl.textContent = `剩餘 ${m}:${String(s).padStart(2, '0')}`;
      cancelBtn.classList.remove('hidden');
    }

    function stopTimer() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      remainingSec = 0;
      updateLabel();
    }

    slot.querySelectorAll('[data-mins]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = Number(btn.dataset.mins);
        stopTimer();
        remainingSec = mins * 60;
        updateLabel();
        toast(`已設定 ${mins} 分鐘後自動暫停`);
        intervalId = setInterval(() => {
          remainingSec -= 1;
          if (remainingSec <= 0) {
            stopTimer();
            bus.emit('player:pause');
            toast('🌙 睡眠時間到，已自動暫停播放');
          } else {
            updateLabel();
          }
        }, 1000);
      });
    });

    cancelBtn.addEventListener('click', () => {
      stopTimer();
      toast('已取消睡眠定時');
    });

    return () => stopTimer();
  }
};
