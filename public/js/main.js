// ===== DISABLE CONTEXT MENU ON MOBILE =====
// Prevent right-click and long-press context menu on touch devices
(function() {
  // Check if device is mobile/touch device
  const isMobileDevice = () => {
    return (typeof window.orientation !== "undefined") 
      || (navigator.userAgent.indexOf('IEMobile') !== -1) 
      || window.innerWidth <= 768;
  };

  if (isMobileDevice()) {
    // Disable text selection via CSS on mobile
    const style = document.createElement('style');
    style.textContent = `
      html, body, * {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
        -webkit-tap-highlight-color: transparent !important;
      }
      ::selection {
        background: transparent !important;
        color: inherit !important;
      }
      ::-moz-selection {
        background: transparent !important;
        color: inherit !important;
      }
    `;
    document.head.appendChild(style);

    // Disable right-click context menu
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    // Disable long-press context menu on touch
    document.addEventListener('touchstart', function(e) {
      let timer;
      timer = setTimeout(() => {
        e.preventDefault();
      }, 500);

      document.addEventListener('touchend', function() {
        clearTimeout(timer);
      }, { once: true });
    }, { passive: false });

    // Disable selection on mousedown/touchstart (except interactive form elements)
    document.addEventListener('selectstart', (e) => {
      if (e.target.closest('input, textarea, select, button, a, form')) return;
      e.preventDefault();
      return false;
    });

    // Disable selection highlighting with input event (except interactive form elements)
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('input, textarea, select, button, a, form')) return;
      if (window.innerWidth <= 768) {
        e.preventDefault();
      }
    });
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // 0. Mobile Sidebar Overlay Handler
  document.addEventListener('click', (e) => {
    // Check if clicked on the overlay (the ::before pseudo-element area)
    // We'll use a different approach - close sidebar when clicking outside
    if (window.innerWidth <= 768 && document.body.classList.contains('sidebar-open')) {
      const sidebar = document.querySelector('.que-sidebar');
      if (sidebar && !sidebar.contains(e.target) && !document.getElementById('queMenuToggle').contains(e.target)) {
        // Close sidebar
        document.body.classList.remove('sidebar-open');
        document.body.classList.remove('sidebar-active');
        sidebar.classList.add('collapsed');
        sidebar.style.display = 'none';
      }
    }
  });

  // 1. Menu Toggle Button Handler (Handled globally by navbar.ejs toggleQueSidebar)
  const menuToggle = document.getElementById('queMenuToggle');
  if (menuToggle && typeof window.toggleQueSidebar !== 'function') {
    menuToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const sidebar = document.querySelector('.que-sidebar');
      if (sidebar) {
        sidebar.classList.toggle('collapsed');
      }
    });
  }

  // 2. Subscribe Button Handler
  const subBtns = document.querySelectorAll('.btn-subscribe');
  subBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('subscribed')) {
        btn.classList.remove('subscribed');
        btn.textContent = '+ Subscribe';
        btn.style.background = 'var(--que-pink)';
        btn.style.color = '#fff';
      } else {
        btn.classList.add('subscribed');
        btn.textContent = 'Subscribed ✓';
        btn.style.background = '#e3e5e7';
        btn.style.color = '#18191c';
      }
    });
  });

  // 3. Like Button AJAX Handler
  const likeBtn = document.getElementById('likeVideoBtn');
  if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
      const videoId = likeBtn.dataset.videoId;
      try {
        const res = await fetch(`/api/video/${videoId}/like`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const countSpan = document.getElementById('likeCount');
          if (countSpan) countSpan.textContent = data.likes;
          likeBtn.style.color = 'var(--que-pink)';
          likeBtn.style.borderColor = 'var(--que-pink)';
        }
      } catch (e) {
        console.error('Like error:', e);
      }
    });
  }

});

// ===== MOBILE: Native YouTube-Style Ultra-Smooth Scroll-Hide/Show Navbar =====
(function() {
  let lastScrollTop = 0;
  let ticking = false;
  const navbar = document.querySelector('.que-navbar');
  if (!navbar) return;

  function updateNavbarState() {
    if (window.innerWidth > 768) {
      navbar.classList.remove('nav-hidden');
      ticking = false;
      return;
    }

    const currentScroll = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
    const scrollDelta = currentScroll - lastScrollTop;

    // At top of page (0 to 15px) -> Always keep navbar visible
    if (currentScroll <= 15) {
      navbar.classList.remove('nav-hidden');
    }
    // Scrolling DOWN significantly (> 8px & past top header) -> Hide navbar smoothly
    else if (scrollDelta > 8 && currentScroll > 60) {
      navbar.classList.add('nav-hidden');
    }
    // Scrolling UP (finger swipe down > 6px) -> Instantly & smoothly show navbar
    else if (scrollDelta < -6) {
      navbar.classList.remove('nav-hidden');
    }

    lastScrollTop = currentScroll;
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(updateNavbarState);
      ticking = true;
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    lastScrollTop = Math.max(0, window.pageYOffset || document.documentElement.scrollTop);
    updateNavbarState();
  }, { passive: true });
})();
