const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'quetube.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Users Table (with password and role support for admin authentication)
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL,
      password TEXT,
      role TEXT DEFAULT 'user',
      avatar TEXT NOT NULL,
      subscribers INTEGER DEFAULT 0,
      banner TEXT
    )
  `);

  // Ensure columns exist if table was already created
  db.run(`ALTER TABLE users ADD COLUMN password TEXT`, (err) => {});
  db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`, (err) => {});

  // Seed default admin and sample user accounts if not existing
  db.get("SELECT * FROM users WHERE username = ?", ['admin'], (err, user) => {
    if (!user) {
      db.run(
        `INSERT INTO users (id, username, handle, password, role, avatar, subscribers) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          'user_admin',
          'admin',
          '@admin',
          'admin123',
          'admin',
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
          999000
        ],
        (err) => {
          if (err) console.error("Admin seed error:", err);
          else console.log("🔑 Default Admin account created (Username: admin, Password: admin123)");
        }
      );
    }
  });

  const sampleUsers = [
    ['user_alex', 'Alex Vance', '@alex_creator', 'user123', 'Creator', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80', 45200],
    ['user_rahul', 'Rahul Sharma', '@rahul_p', 'user123', 'Premium Member', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80', 1200],
    ['user_priya', 'Priya Singh', '@priya_stream', 'user123', 'Creator', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80', 12800],
    ['user_michael', 'Michael Scott', '@michael_user', 'user123', 'Subscriber', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&q=80', 320]
  ];

  sampleUsers.forEach(([id, username, handle, password, role, avatar, subscribers]) => {
    db.get("SELECT * FROM users WHERE id = ?", [id], (err, u) => {
      if (!u) {
        db.run(
          `INSERT INTO users (id, username, handle, password, role, avatar, subscribers) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, username, handle, password, role, avatar, subscribers]
        );
      }
    });
  });

  // 2. Videos Table (Content / Movies / Shows Catalog)
  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      movie_name TEXT DEFAULT '',
      short_about TEXT DEFAULT '',
      description TEXT,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT NOT NULL,
      main_image_url TEXT DEFAULT '',
      mobile_image_url TEXT DEFAULT '',
      sidebar_image_url TEXT DEFAULT '',
      category TEXT DEFAULT 'General',
      section TEXT DEFAULT 'none',
      homepage_section TEXT DEFAULT 'none',
      grid_position TEXT DEFAULT 'none',
      duration TEXT DEFAULT '03:45',
      release_date TEXT DEFAULT '',
      language TEXT DEFAULT '',
      size TEXT DEFAULT '410Mb 680Mb 1Gb 2.5Gb 4.9Gb 6.1Gb 9.3Gb HD',
      quality TEXT DEFAULT 'PreDvD',
      bio_label_type TEXT DEFAULT 'Bio',
      media_type TEXT DEFAULT 'video',
      tags TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      danmaku_count INTEGER DEFAULT 0,
      uploader_id TEXT,
      uploader_name TEXT,
      uploader_avatar TEXT,
      time_ago TEXT DEFAULT 'Just now',
      is_featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ensure optional columns exist if table was created in earlier schema version
  db.run(`ALTER TABLE videos ADD COLUMN homepage_section TEXT DEFAULT 'none'`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN grid_position TEXT DEFAULT 'none'`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN media_type TEXT DEFAULT 'video'`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN release_date TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN language TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN main_image_url TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN mobile_image_url TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN sidebar_image_url TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN short_about TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN movie_name TEXT DEFAULT ''`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN size TEXT DEFAULT '410Mb 680Mb 1Gb 2.5Gb 4.9Gb 6.1Gb 9.3Gb HD'`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN quality TEXT DEFAULT 'PreDvD'`, (err) => {});
  db.run(`ALTER TABLE videos ADD COLUMN bio_label_type TEXT DEFAULT 'Bio'`, (err) => {});

  // 3. Comments Table
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_avatar TEXT NOT NULL,
      text TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3.5. Danmaku Bullet Comments Table
  db.run(`
    CREATE TABLE IF NOT EXISTS danmaku (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_name TEXT DEFAULT 'Anonymous',
      text TEXT NOT NULL,
      color TEXT DEFAULT '#00e5ff',
      timestamp REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Categories Table (Dynamic OTT Category Management)
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      in_sidebar INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run("ALTER TABLE categories ADD COLUMN in_sidebar INTEGER DEFAULT 1", (err) => {});
  db.run("ALTER TABLE categories ADD COLUMN image_url TEXT", (err) => {});
  // Ensure slug always equals name for all categories
  db.run("UPDATE categories SET slug = name", (err) => {});

  // 6. Category Placements Table (Category-Specific Placements for Hero & 2x2 Grid)
  db.run(`
    CREATE TABLE IF NOT EXISTS category_placements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      slot_type TEXT NOT NULL,
      position TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(category, slot_type, position)
    )
  `);

  // Category Placements table (Permanent persistence across server restarts)

  db.get("SELECT COUNT(*) as count FROM categories", (err, row) => {
    if (!err && row.count === 0) {
      console.log("📁 Seeding initial Categories for Browse Catalog & Top Bar...");
      const initialCategories = [
        { id: 'cat_anim_mov', name: 'Animation Movies', slug: 'Animation Movies', in_sidebar: 1, display_order: 1, image_url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_bolly_mov', name: 'Bollywood Movies', slug: 'Bollywood Movies', in_sidebar: 1, display_order: 2, image_url: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_holly_mov', name: 'Hollywood Movies', slug: 'Hollywood Movies', in_sidebar: 1, display_order: 3, image_url: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_marvel_mov', name: 'Marvel Hollywood Movies', slug: 'Marvel Hollywood Movies', in_sidebar: 1, display_order: 4, image_url: 'https://images.unsplash.com/photo-1568832359672-e36cf5d74f54?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_movies', name: 'Movies', slug: 'Movies', in_sidebar: 1, display_order: 5, image_url: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_webseries', name: 'Web Series', slug: 'Web Series', in_sidebar: 1, display_order: 6, image_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=400&q=80' },
        { id: 'cat_anime', name: 'Anime', slug: 'Anime', in_sidebar: 1, display_order: 7, image_url: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&w=400&q=80' }
      ];

      const stmt = db.prepare("INSERT INTO categories (id, name, slug, display_order, in_sidebar, image_url) VALUES (?, ?, ?, ?, ?, ?)");
      initialCategories.forEach(c => {
        stmt.run(c.id, c.name, c.name, c.display_order, c.in_sidebar, c.image_url);
      });
      stmt.finalize();
    }
  });

  // 7. Custom Sections Table (Dynamic Section Creator for Homepage & Decorate Videos)
  db.run(`
    CREATE TABLE IF NOT EXISTS custom_sections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      section_key TEXT NOT NULL UNIQUE,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.get("SELECT COUNT(*) as count FROM custom_sections", (err, row) => {
    if (!err && row.count === 0) {
      console.log("📁 Seeding initial Custom Sections for Homepage...");
      const initSecs = [
        { id: 'sec_trending', title: 'Trending Now', section_key: 'trending', display_order: 1 }
      ];
      const stmt = db.prepare("INSERT INTO custom_sections (id, title, section_key, display_order) VALUES (?, ?, ?, ?)");
      initSecs.forEach(s => stmt.run(s.id, s.title, s.section_key, s.display_order));
      stmt.finalize();
    }
  });

  // Clean up 'sec_recommended' or 'recommended' entry from custom_sections table
  db.run("DELETE FROM custom_sections WHERE section_key = 'recommended' OR id = 'sec_recommended'", (err) => {});

  // 5. Browse Catalog Table (8 Customizable Sidebar Slots)
  db.run(`
    CREATE TABLE IF NOT EXISTS browse_catalog (
      slot_index INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL
    )
  `);

  // Clean up any old 'Home' entry from browse_catalog table
  db.run("DELETE FROM browse_catalog WHERE name = 'Home' OR url = '/'", (err) => {});

  db.get("SELECT COUNT(*) as count FROM browse_catalog", (err, row) => {
    if (!err && row.count === 0) {
      console.log("📌 Seeding default Browse Catalog Category slots...");
      const defaultSlots = [
        { slot_index: 1, name: 'Animation Movies', url: '/?category=Animation%20Movies' },
        { slot_index: 2, name: 'Bollywood Movies', url: '/?category=Bollywood%20Movies' },
        { slot_index: 3, name: 'Hollywood Movies', url: '/?category=Hollywood%20Movies' },
        { slot_index: 4, name: 'Marvel Hollywood Movies', url: '/?category=Marvel%20Hollywood%20Movies' },
        { slot_index: 5, name: 'Movies', url: '/?category=Movies' },
        { slot_index: 6, name: 'Web Series', url: '/?category=Web%20Series' },
        { slot_index: 7, name: 'Anime', url: '/?category=Anime' }
      ];

      const stmt = db.prepare("INSERT INTO browse_catalog (slot_index, name, url) VALUES (?, ?, ?)");
      defaultSlots.forEach(s => {
        stmt.run(s.slot_index, s.name, s.url);
      });
      stmt.finalize();
    }
  });

  // Auto-restore stored uploads from db/uploads_store.json into SQLite database if missing
  try {
    const uploadStore = require('./uploadStore');
    const storedItems = uploadStore.getStoredUploads();
    if (storedItems && storedItems.length > 0) {
      storedItems.forEach(v => {
        db.get('SELECT id FROM videos WHERE id = ?', [v.id], (err, row) => {
          if (!err && !row) {
            db.run(
              `INSERT INTO videos (id, title, movie_name, description, video_url, thumbnail_url, main_image_url, mobile_image_url, sidebar_image_url, category, section, homepage_section, grid_position, tags, uploader_id, uploader_name, uploader_avatar, duration, media_type, release_date, language, short_about, size, quality, bio_label_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                v.id, v.title, v.movie_name || v.title, v.description || '', v.video_url || '#',
                v.thumbnail_url || '', v.main_image_url || v.thumbnail_url || '',
                v.mobile_image_url || v.thumbnail_url || '', v.sidebar_image_url || v.thumbnail_url || '',
                v.category || 'General', v.section || 'none', v.homepage_section || 'none',
                v.grid_position || 'none', v.tags || '', v.uploader_id || 'user_custom',
                v.uploader_name || 'QueTue Studio', v.uploader_avatar || '', v.duration || '',
                v.media_type || 'video', v.release_date || '', v.language || '',
                v.short_about || '', v.size || '410Mb 680Mb 1Gb 2.5Gb 4.9Gb 6.1Gb 9.3Gb HD',
                v.quality || 'PreDvD', v.bio_label_type || 'Bio'
              ],
              (insertErr) => {
                if (!insertErr) console.log(`🔄 Auto-restored video post ${v.id} (${v.title}) from uploads_store.json`);
              }
            );
          }
        });
      });
    }
  } catch (e) {
    console.error('Error auto-restoring from uploads_store.json:', e);
  }
});

db.deleteVideoCompletely = function(videoId, callback) {
  // 1. Fetch video record first to inspect local media paths
  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, video) => {
    if (err) {
      console.error('Error fetching video before delete:', err);
      if (callback) callback(err);
      return;
    }

    // 2. Delete main entry from videos table
    db.run('DELETE FROM videos WHERE id = ?', [videoId], (err) => {
      if (err) console.error('Error deleting video record:', err);

      // 3. Delete associated comments
      db.run('DELETE FROM comments WHERE video_id = ?', [videoId], (err) => {
        if (err) console.error('Error deleting associated comments:', err);
      });

      // 4. Delete associated danmaku bullet messages
      db.run('DELETE FROM danmaku WHERE video_id = ?', [videoId], (err) => {
        if (err) console.error('Error deleting associated danmaku:', err);
      });

      // 5. Delete from db/uploads_store.json file
      try {
        const uploadStore = require('./uploadStore');
        uploadStore.deleteUpload(videoId);
      } catch (e) {
        console.error('Error removing from uploadStore:', e);
      }

      // 6. Delete local files from disk if stored under /uploads/
      if (video) {
        const localPaths = [video.thumbnail_url, video.main_image_url, video.sidebar_image_url, video.video_url];
        localPaths.forEach(urlPath => {
          if (urlPath && urlPath.startsWith('/uploads/')) {
            const absolutePath = path.join(__dirname, '../public', urlPath);
            if (fs.existsSync(absolutePath)) {
              try {
                fs.unlinkSync(absolutePath);
                console.log(`🗑️ Deleted local upload file: ${urlPath}`);
              } catch (unlinkErr) {
                console.error(`Failed to delete local file ${absolutePath}:`, unlinkErr);
              }
            }
          }
        });
      }

      console.log(`✅ Video ${videoId} completely deleted from DB, comments, danmaku, uploads_store.json, and local files.`);
      if (callback) callback(null);
    });
  });
};

module.exports = db;
