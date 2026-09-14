  /* ------------------------------------------------------------------ panneau glissant */
  const sheetVisible = () => Math.max(0, window.innerHeight - sheet.getBoundingClientRect().top);   // hauteur visible (le panneau est translaté, pas redimensionné)
  let sheetT = null;
  function setSheet(mode) {
    const was = [...sheet.classList].find((c) => ['peek', 'half', 'full'].includes(c));
    sheet.classList.remove('peek', 'half', 'full'); sheet.classList.add(mode);
    document.documentElement.style.setProperty('--sheet-h', mode === 'peek' ? '30vh' : mode === 'half' ? '58vh' : '100vh');
    if (was !== mode && viewBounds && state.mapFilter && isMobile()) {   // la surface de carte visible a changé : l'emprise suivie aussi
      clearTimeout(sheetT); sheetT = setTimeout(() => { if (!map) return; viewBounds = liveBounds(); if (state.view === 'explore' && $('#panel-detail').hidden && $('#panel-poi').hidden) { renderDays(); renderList({ keep: true }); } }, 300);
    }
  }
  function initSheet() {
    sheet = $('#sheet'); setSheet('half');
    const order = ['peek', 'half', 'full'], cur = () => order.find((m) => sheet.classList.contains(m));
    const move = (dir) => { const i = order.indexOf(cur()); setSheet(order[Math.max(0, Math.min(2, i + dir))]); };
    /* Glisser : le panneau suit le doigt ; au relâcher, aimantation vers la hauteur la plus proche
       en tenant compte de la vitesse (un geste vif suffit à changer d'état). */
    let drag = null;
    const start = (y) => { if (!isMobile()) return; drag = { y0: y, h0: sheetVisible(), full: sheet.offsetHeight, t0: performance.now(), y: y, t: performance.now(), moved: false }; sheet.classList.add('dragging'); };
    const update = (y) => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: drag.full };
      let h = drag.h0 + (drag.y0 - y);
      if (h > hs.full) h = hs.full + (h - hs.full) * 0.2; if (h < hs.peek) h = hs.peek - (hs.peek - h) * 0.2;
      if (Math.abs(y - drag.y0) > 4) drag.moved = true;
      drag.vy = (y - drag.y) / Math.max(1, performance.now() - drag.t); drag.y = y; drag.t = performance.now();
      sheet.style.transform = `translateY(${Math.max(0, drag.full - h)}px)`;
    };
    const end = () => {
      if (!drag) return;
      const H = window.innerHeight, hs = { peek: H * 0.30, half: H * 0.58, full: drag.full };
      const h = sheetVisible(), vy = drag.vy || 0, moved = drag.moved;
      sheet.classList.remove('dragging'); sheet.style.transform = '';
      if (!moved) { move(cur() === 'full' ? -1 : 1); drag = null; return; }
      let target;
      if (Math.abs(vy) > 0.6) target = vy < 0 ? order[Math.min(2, order.indexOf(cur()) + 1)] : order[Math.max(0, order.indexOf(cur()) - 1)];
      else target = Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
      setSheet(target); drag = null;
    };
    for (const zone of [$('#handle'), $('#tabs')]) {
      zone.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && zone !== $('#handle')) return; if (e.target.closest('button') && zone !== $('#handle') && e.pointerType === 'mouse') return; start(e.clientY); zone.setPointerCapture?.(e.pointerId); });
      zone.addEventListener('pointermove', (e) => update(e.clientY));
      zone.addEventListener('pointerup', (e) => { const wasDrag = drag && drag.moved; end(); if (wasDrag && e.target.closest('button')) e.preventDefault(); });
      zone.addEventListener('pointercancel', end);
    }
    document.addEventListener('pointerup', () => { if (drag) end(); }); document.addEventListener('pointercancel', () => { if (drag) end(); });   // relâcher hors de la zone termine le geste
    $('#tabs').addEventListener('click', (e) => { if (drag) e.stopPropagation(); }, true);
    // Tirer vers le bas depuis le haut de la liste replie le panneau (tactile uniquement)
    const panel = $('#panels'); let y0 = null;
    panel.addEventListener('touchstart', (e) => { y0 = panel.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy > 70 && panel.scrollTop === 0) move(-1); y0 = null; }, { passive: true });
    // Clavier : la recherche déploie le panneau pour rester visible au-dessus du clavier
    sheet.addEventListener('focusin', (e) => {
      const t = e.target; if (!isMobile() || !t.matches('input, textarea, select')) return;
      if (!sheet.classList.contains('full')) setSheet('full');
      setTimeout(() => { try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { } }, 320);
    });
  }

