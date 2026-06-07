'use strict';

(function () {
  var hamburger = document.getElementById('btnHamburger');
  var overlay   = document.getElementById('sidebarOverlay');
  var sidebar   = document.getElementById('sidebar');

  if (!hamburger || !overlay || !sidebar) return;

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    hamburger.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    hamburger.setAttribute('aria-expanded', 'false');
  }

  hamburger.addEventListener('click', function () {
    document.body.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('.sidebar-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 768) closeSidebar();
  });
})();
