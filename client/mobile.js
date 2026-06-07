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

// Tree panel vertical drag-to-resize
(function () {
  var handle = document.getElementById('treeResizeHandle');
  if (!handle) return;

  var STORAGE_KEY = 'treeHeight';
  var MIN_H = 80;
  var MAX_RATIO = 0.70;

  function getTreeContainer() {
    return document.querySelector('.tree-container');
  }

  function restoreSavedHeight() {
    if (window.innerWidth > 768) return;
    var saved = localStorage.getItem(STORAGE_KEY);
    var tc = getTreeContainer();
    if (saved && tc) tc.style.maxHeight = saved + 'px';
  }

  restoreSavedHeight();

  var startY = 0;
  var startH = 0;
  var dragging = false;

  handle.addEventListener('touchstart', function (e) {
    var tc = getTreeContainer();
    if (!tc) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startH = tc.getBoundingClientRect().height;
    e.preventDefault();
  }, { passive: false });

  handle.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    var tc = getTreeContainer();
    if (!tc) return;
    var dy = e.touches[0].clientY - startY;
    var maxH = Math.round(window.innerHeight * MAX_RATIO);
    var newH = Math.max(MIN_H, Math.min(maxH, startH + dy));
    tc.style.maxHeight = newH + 'px';
    e.preventDefault();
  }, { passive: false });

  handle.addEventListener('touchend', function () {
    if (!dragging) return;
    dragging = false;
    var tc = getTreeContainer();
    if (tc) {
      var h = tc.getBoundingClientRect().height;
      localStorage.setItem(STORAGE_KEY, Math.round(h));
    }
  });
})();
