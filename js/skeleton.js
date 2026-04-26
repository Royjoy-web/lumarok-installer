// ============================================
// LUMAROK — js/skeleton.js
// Skeleton loading states + pull-to-refresh
// ============================================

// ── Skeleton card HTML ────────────────────────────────────────
const SKELETON_DEVICE_CARD = `
<div class="device-card skeleton" aria-hidden="true">
  <div class="sk-icon sk-pulse"></div>
  <div class="sk-lines">
    <div class="sk-line sk-pulse" style="width:60%"></div>
    <div class="sk-line sk-pulse" style="width:40%"></div>
  </div>
  <div class="sk-toggle sk-pulse"></div>
</div>`;

const SKELETON_ROOM_SECTION = `
<div class="room-section skeleton" aria-hidden="true">
  <div class="sk-line sk-pulse" style="width:35%;height:18px;margin-bottom:12px"></div>
  <div class="sk-grid">
    ${SKELETON_DEVICE_CARD.repeat(4)}
  </div>
</div>`;

// Show N skeleton cards in container
function showSkeletons(containerId, count=4, type='device') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const tpl = type === 'room' ? SKELETON_ROOM_SECTION : SKELETON_DEVICE_CARD;
  el.innerHTML = tpl.repeat(count);
}

function clearSkeletons(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.querySelectorAll('.skeleton').forEach(s => s.remove());
}

// ── Pull-to-refresh ───────────────────────────────────────────
const PullToRefresh = (() => {
  const THRESHOLD = 72; // px to trigger
  let startY=0, currentY=0, pulling=false, indicator=null;

  const createIndicator = () => {
    indicator = document.createElement('div');
    indicator.id = 'ptr-indicator';
    indicator.innerHTML = '<span class="ptr-icon">↓</span><span class="ptr-text">Pull to refresh</span>';
    indicator.style.cssText = [
      'position:fixed;top:-56px;left:50%;transform:translateX(-50%)',
      'background:var(--elevated);border-radius:28px;padding:8px 20px',
      'display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500',
      'color:var(--t2);z-index:9000;transition:top 200ms var(--ease)',
      'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
    ].join(';');
    document.body.appendChild(indicator);
  };

  const init = (scrollEl, onRefresh) => {
    if (!scrollEl) return;
    createIndicator();

    scrollEl.addEventListener('touchstart', e => {
      if (scrollEl.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive:true });

    scrollEl.addEventListener('touchmove', e => {
      if (!pulling) return;
      currentY = e.touches[0].clientY;
      const dist = Math.min(currentY - startY, THRESHOLD * 1.5);
      if (dist > 0) {
        indicator.style.top = Math.min(dist - 56 + 8, 16) + 'px';
        indicator.querySelector('.ptr-text').textContent =
          dist > THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
        indicator.querySelector('.ptr-icon').style.transform =
          `rotate(${dist > THRESHOLD ? 180 : 0}deg)`;
      }
    }, { passive:true });

    scrollEl.addEventListener('touchend', async () => {
      if (!pulling) return;
      pulling = false;
      const dist = currentY - startY;
      indicator.style.top = '-56px';

      if (dist > THRESHOLD) {
        haptic('medium');
        indicator.querySelector('.ptr-text').textContent = 'Refreshing…';
        await onRefresh();
      }
    });
  };

  return { init };
})();

// ── Inject skeleton CSS ───────────────────────────────────────
(function injectSkeletonCSS() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes sk-shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position:  400px 0; }
    }
    .sk-pulse {
      background: linear-gradient(90deg, var(--elevated) 25%, var(--card-hi) 50%, var(--elevated) 75%);
      background-size: 800px 100%;
      animation: sk-shimmer 1.4s infinite linear;
      border-radius: var(--r-sm);
    }
    .sk-line  { height:12px; margin-bottom:6px; }
    .sk-icon  { width:40px; height:40px; border-radius:50%; flex-shrink:0; }
    .sk-toggle{ width:44px; height:26px; border-radius:13px; }
    .sk-lines { flex:1; }
    .sk-grid  { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
    .device-card.skeleton { display:flex; align-items:center; gap:12px; padding:16px; }
    .ptr-icon { transition: transform 200ms ease; display:inline-block; }
  `;
  document.head.appendChild(style);
})();
