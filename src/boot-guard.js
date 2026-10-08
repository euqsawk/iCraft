// Garde-fou du démarrage (script classique, chargé avant le jeu).
// Si le jeu ne démarre pas, on affiche l'erreur au lieu d'un écran blanc,
// avec un bouton qui vide le cache hors ligne (la sauvegarde est conservée).
(function () {
  var errors = [];
  function note(msg) {
    if (msg && errors.indexOf(msg) < 0) errors.push(String(msg).slice(0, 300));
  }
  window.addEventListener('error', function (e) {
    note((e.message || 'Erreur') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    note(r && r.message ? r.message : String(r));
  });

  function show(title) {
    if (window.__gameStarted || document.getElementById('boot-guard')) return;
    var box = document.createElement('div');
    box.id = 'boot-guard';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:99;background:#DCEBE3;color:#2E3A4B;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;box-sizing:border-box;font:700 14px/1.4 -apple-system,system-ui,sans-serif;text-align:center');
    var h = document.createElement('b');
    h.textContent = title;
    h.setAttribute('style', 'font-size:18px;font-weight:900');
    var p = document.createElement('div');
    p.textContent = errors.length ? errors.join(' · ') : 'Aucune erreur signalée par le navigateur.';
    p.setAttribute('style', 'max-width:320px;font-size:12px;color:#4A5868;word-break:break-word;user-select:text;-webkit-user-select:text');
    var ua = document.createElement('div');
    ua.textContent = navigator.userAgent;
    ua.setAttribute('style', 'max-width:320px;font-size:10px;color:#6B7684;word-break:break-word;user-select:text;-webkit-user-select:text');
    var btn = document.createElement('button');
    btn.textContent = 'Vider le cache et relancer';
    btn.setAttribute('style', 'height:46px;padding:0 18px;border:none;border-radius:14px;background:#2E3A4B;color:#fff;font:900 14px -apple-system,system-ui,sans-serif');
    btn.onclick = function () {
      var jobs = [];
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
        }
      } catch (e) { /* cadre protégé */ }
      try {
        if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
      } catch (e) { /* cadre protégé */ }
      Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
    };
    box.appendChild(h); box.appendChild(p); box.appendChild(ua); box.appendChild(btn);
    (document.body || document.documentElement).appendChild(box);
  }

  window.__bootFailed = function (msg) { note(msg); show('Le jeu n’a pas pu démarrer'); };
  setTimeout(function () { show('Le jeu ne démarre pas'); }, 9000);
})();
