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

// Tree panel vertical drag-to-resize (resizes .panel-tree height)
(function () {
  var handle = document.getElementById('treeResizeHandle');
  if (!handle) return;

  var STORAGE_KEY = 'panelTreeHeight';
  var MIN_H = 120;
  var MAX_RATIO = 0.75;

  function getPanelTree() {
    return document.querySelector('.panel-tree');
  }

  function restoreSavedHeight() {
    if (window.innerWidth > 768) return;
    var saved = localStorage.getItem(STORAGE_KEY);
    var pt = getPanelTree();
    if (saved && pt) pt.style.height = saved + 'px';
  }

  restoreSavedHeight();

  var startY = 0;
  var startH = 0;
  var dragging = false;

  handle.addEventListener('touchstart', function (e) {
    var pt = getPanelTree();
    if (!pt) return;
    dragging = true;
    startY = e.touches[0].clientY;
    startH = pt.getBoundingClientRect().height;
    e.preventDefault();
  }, { passive: false });

  handle.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    var pt = getPanelTree();
    if (!pt) return;
    var dy = e.touches[0].clientY - startY;
    var maxH = Math.round(window.innerHeight * MAX_RATIO);
    var newH = Math.max(MIN_H, Math.min(maxH, startH + dy));
    pt.style.height = newH + 'px';
    e.preventDefault();
  }, { passive: false });

  handle.addEventListener('touchend', function () {
    if (!dragging) return;
    dragging = false;
    var pt = getPanelTree();
    if (pt) {
      var h = pt.getBoundingClientRect().height;
      localStorage.setItem(STORAGE_KEY, Math.round(h));
    }
  });
})();
