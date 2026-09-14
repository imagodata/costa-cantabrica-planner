  /* ------------------------------------------------------------------ premier lancement */
  function showIntro() {
    let seen = false; try { seen = localStorage.getItem('ccp:intro') === '1'; } catch (e) { }
    if (seen || wishedIds().length) return;
    const steps = [
      { icon: 'compass', title: 'Explorer', text: `Choisissez le jour et votre profil (plage, famille, surf, balade) : chaque plage reçoit un score selon la météo, le vent et la houle. Touchez un point de la carte ou la liste pour la fiche complète : marées, heure par heure, photos, lieux à proximité.` },
      { icon: 'heart', title: 'À deux', text: `${esc(state.users.a.name)} et ${esc(state.users.b.name)} marquent chacun leurs envies avec le cœur de leur couleur, se proposent des plages et notent chaque programme. L'onglet « Envies » réunit les listes, numérote les plages d'ouest en est et prépare l'itinéraire.` },
      { icon: 'calendar', title: 'Programmer', text: `Dans une fiche, ajoutez un resto, un monument ou une activité au programme de la plage. L'onglet « Séjour » place votre hébergement, répartit les plages sur les jours selon la météo, estime les horaires et prépare chaque trajet dans Google Maps.` },
      { icon: 'boot', title: 'Relief 3D', text: `Zoomez : la carte passe en 3D sur l'orthophoto et le relief (bouton 2D pour revenir). « Suivre l'itinéraire en 3D » survole chaque journée étape par étape. Avec un compte (page de connexion), le séjour est partagé à deux sur tous vos appareils ; sans compte, tout se partage par lien.` },
    ];
    const dlg = $('#dlg-intro'); let i = 0;
    const render = () => {
      const st = steps[i];
      $('#intro-steps').innerHTML = `<div class="intro-step"><span class="ic-box">${I(st.icon, { size: 22 })}</span><div><h2>${st.title}</h2><p>${st.text}</p></div></div>
        <div class="intro-dots">${steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>`;
      $('#intro-next').textContent = i === steps.length - 1 ? "C'est parti" : 'Suivant';
    };
    const done = () => { try { localStorage.setItem('ccp:intro', '1'); } catch (e) { } dlg.close(); };
    $('#intro-next').onclick = () => { if (i < steps.length - 1) { i++; render(); } else done(); };
    $('#intro-skip').onclick = done;
    dlg.addEventListener('close', () => { try { localStorage.setItem('ccp:intro', '1'); } catch (e) { } }, { once: true });
    render(); dlg.showModal();
  }

