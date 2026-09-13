/* Glissement horizontal piloté par pointer events pour un conteneur à diapos (scroll-snap).
   Le navigateur garde le défilement vertical (touch-action: pan-y) ; l'horizontal est géré ici,
   avec aimantation à la diapo la plus proche et prise en compte de la vitesse du geste. */
window.CCP = window.CCP || {};
CCP.swipeable = function (el, { onTap } = {}) {
  let st = null;
  const w = () => el.clientWidth || 1;
  const snapTo = (i) => { el.style.scrollSnapType = ''; el.scrollTo({ left: Math.max(0, Math.min(el.children.length - 1, i)) * w(), behavior: 'smooth' }); };
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    st = { x0: e.clientX, y0: e.clientY, s0: el.scrollLeft, t0: performance.now(), x: e.clientX, t: performance.now(), vx: 0, horiz: null, id: e.pointerId };
  }, { passive: true });
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (st.horiz === null) { if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; st.horiz = Math.abs(dx) > Math.abs(dy); if (st.horiz) { el.setPointerCapture?.(e.pointerId); el.style.scrollSnapType = 'none'; } }
    if (!st.horiz) return;
    const now = performance.now(); st.vx = (e.clientX - st.x) / Math.max(1, now - st.t); st.x = e.clientX; st.t = now;
    el.scrollLeft = st.s0 - dx;
    if (e.cancelable) e.preventDefault();
  });
  const end = (e) => {
    if (!st || (e && e.pointerId !== st.id)) return;
    const s = st; st = null;
    if (s.horiz === null) { if (onTap && e && e.type === 'pointerup') onTap(e); return; }
    if (!s.horiz) return;
    const cur = el.scrollLeft / w();
    let target = Math.round(cur);
    if (Math.abs(s.vx) > 0.35) target = s.vx < 0 ? Math.ceil(cur) : Math.floor(cur);
    snapTo(target);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', () => { if (st && st.horiz) end({ pointerId: st.id, type: 'pointercancel' }); });
  el.addEventListener('dragstart', (e) => e.preventDefault());
  return { go: snapTo };
};
