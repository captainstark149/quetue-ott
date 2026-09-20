class DanmakuEngine {
  constructor(videoElement, containerElement, danmakuList = [], socket = null) {
    this.video = videoElement;
    this.container = containerElement;
    this.list = danmakuList;
    this.socket = socket;
    this.enabled = true;
    this.renderedIds = new Set();

    this.initEvents();
  }

  initEvents() {
    if (!this.video || !this.container) return;

    // Listen to video timeupdate
    this.video.addEventListener('timeupdate', () => {
      if (!this.enabled || this.video.paused) return;
      this.checkAndRenderBullets();
    });

    // Reset rendered cache when video loops or seeks
    this.video.addEventListener('seeking', () => {
      this.clearBullets();
      this.renderedIds.clear();
    });

    // Socket real-time Danmaku listener
    if (this.socket) {
      this.socket.on('new_danmaku', (danmaku) => {
        this.list.push(danmaku);
        this.spawnBullet(danmaku);
      });
    }
  }

  toggleDanmaku() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.clearBullets();
    }
    return this.enabled;
  }

  checkAndRenderBullets() {
    const currentTime = this.video.currentTime;

    this.list.forEach((d) => {
      if (!this.renderedIds.has(d.id) && Math.abs(d.timestamp - currentTime) < 0.6) {
        this.renderedIds.add(d.id);
        this.spawnBullet(d);
      }
    });
  }

  spawnBullet(danmaku) {
    if (!this.enabled) return;

    const bullet = document.createElement('div');
    bullet.className = 'danmaku-item';
    bullet.textContent = danmaku.text;
    bullet.style.color = danmaku.color || '#00e5ff';

    // Random lane/vertical position (between 5% and 80%)
    const topPosition = Math.floor(Math.random() * 75) + 5;
    bullet.style.top = `${topPosition}%`;

    this.container.appendChild(bullet);

    // Remove element after animation completes
    bullet.addEventListener('animationend', () => {
      bullet.remove();
    });
  }

  clearBullets() {
    this.container.innerHTML = '';
  }

  addBulletLocal(danmaku) {
    this.list.push(danmaku);
    this.spawnBullet(danmaku);
  }
}

// Global helper initialization
window.initDanmakuEngine = (videoEl, containerEl, initialDanmaku, socket) => {
  return new DanmakuEngine(videoEl, containerEl, initialDanmaku, socket);
};
