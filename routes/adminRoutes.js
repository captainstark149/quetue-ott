const express = require('express');
const router = express.Router();
const db = require('../db/database');
const uploadStore = require('../db/uploadStore');

// Rate-limiting tracker for admin login attempts (IP -> { count, lockUntil })
const loginAttempts = new Map();

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (!attempt) return { allowed: true };
  if (attempt.lockUntil && now < attempt.lockUntil) {
    const remainingMins = Math.ceil((attempt.lockUntil - now) / (60 * 1000));
    return { allowed: false, remainingMins };
  }
  if (attempt.lockUntil && now >= attempt.lockUntil) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  let attempt = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= 5) {
    attempt.lockUntil = now + 15 * 60 * 1000; // 15-minute lock after 5 failed attempts
  }
  loginAttempts.set(ip, attempt);
}

function recordSuccessfulLogin(ip) {
  loginAttempts.delete(ip);
}

// Middleware to protect admin-only routes
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Admin authentication required.' });
  }
  if (req.method === 'GET') {
    req.session.returnTo = req.originalUrl;
  } else {
    req.session.returnTo = '/admin249/dashboard';
  }
  res.redirect('/admin249/login?error=Admin login required to access this feature.');
}

// GET /admin or /admin249/ -> Redirect to dashboard or login
router.get('/', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin249/dashboard');
  }
  return res.redirect('/admin249/login');
});

// GET /admin249/login
router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin249/dashboard');
  }
  const errorMsg = req.query.error || null;
  res.render('admin_login', { error: errorMsg, title: 'Admin Login - QueTue' });
});

// POST /admin249/login
router.post('/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    return res.render('admin_login', {
      error: `Too many failed login attempts. Portal temporarily locked for security. Try again in ${rateLimit.remainingMins} minute(s).`,
      title: 'Admin Login - QueTue'
    });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('admin_login', { error: 'Please enter both username and password.', title: 'Admin Login - QueTue' });
  }

  const cleanUser = username.trim();
  const cleanPass = password.trim();

  // Check admin user in SQLite DB
  db.get('SELECT * FROM users WHERE (username = ? OR handle = ?) AND role = ?', [cleanUser, `@${cleanUser}`, 'admin'], (err, user) => {
    if (err) {
      console.error("Admin login DB error:", err);
      return res.render('admin_login', { error: 'Database error occurred.', title: 'Admin Login - QueTue' });
    }

    // Strict DB user password check (No insecure hardcoded fallbacks)
    const isMatch = user && user.password === cleanPass;

    if (isMatch) {
      recordSuccessfulLogin(ip);

      const redirectUrl = req.session.returnTo || '/admin249/dashboard';
      delete req.session.returnTo;

      // Regenerate Session ID to prevent Session Fixation attacks
      req.session.regenerate((err) => {
        if (err) console.error("Session regenerate error:", err);
        req.session.isAdmin = true;
        req.session.adminUser = user;
        return res.redirect(redirectUrl);
      });
    } else {
      recordFailedLogin(ip);
      return res.render('admin_login', { error: 'Invalid admin username or password.', title: 'Admin Login - QueTue' });
    }
  });
});

// POST /admin249/change-password
router.post('/change-password', requireAdmin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const adminId = (req.session && req.session.adminUser && req.session.adminUser.id) ? req.session.adminUser.id : 'user_admin';

  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('All password fields are required.'));
  }

  if (new_password !== confirm_password) {
    return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('New password and confirmation password do not match.'));
  }

  if (new_password.length < 6) {
    return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('New password must be at least 6 characters long.'));
  }

  db.get('SELECT * FROM users WHERE (id = ? OR username = ?) AND role = ?', [adminId, 'admin', 'admin'], (err, user) => {
    if (err || !user) {
      return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('Admin user account not found.'));
    }

    if (user.password !== current_password.trim()) {
      return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('Current password entered is incorrect.'));
    }

    db.run('UPDATE users SET password = ? WHERE id = ?', [new_password.trim(), user.id], (err2) => {
      if (err2) {
        console.error("Change password DB error:", err2);
        return res.redirect('/admin249/dashboard?error=' + encodeURIComponent('Failed to update password in database.'));
      }
      return res.redirect('/admin249/dashboard?success=' + encodeURIComponent('Admin password updated successfully! Please keep it secure.'));
    });
  });
});

// GET /admin249/logout
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('quetue_admin_sid');
      res.redirect('/admin249/login?error=Logged out successfully.');
    });
  } else {
    res.redirect('/admin249/login');
  }
});

// GET /admin249/dashboard
router.get('/dashboard', requireAdmin, (req, res) => {
  const rawCat = req.query.cat || req.query.category || 'All';
  const selectedSection = req.query.section || null;
  const sectionMode = req.query.mode || null;
  const rawLower = rawCat.toLowerCase().trim();
  let selectedCat = rawCat;

  if (rawLower === 'movie' || rawLower === 'movies') {
    selectedCat = 'Movies';
  } else if (rawLower === 'series' || rawLower === 'web series' || rawLower === 'tv' || rawLower === 'tv series') {
    selectedCat = 'Web Series';
  } else if (rawLower === 'anime' || rawLower === 'animation') {
    selectedCat = 'Anime';
  } else if (rawLower === 'categories' || rawLower === 'category') {
    selectedCat = 'Categories';
  } else if (rawLower === 'decorate' || rawLower === 'decorate videos' || rawLower === 'decorate-videos') {
    selectedCat = 'Decorate Videos';
  } else if (rawLower === 'all') {
    selectedCat = 'All';
  }

  db.all('SELECT * FROM videos ORDER BY created_at DESC', [], (err, videos) => {
    if (err) {
      console.error(err);
      videos = [];
    }

    db.all('SELECT * FROM users', [], (errUsers, usersList) => {
      const userCount = usersList ? usersList.length : 0;

      let placeSql = 'SELECT * FROM category_placements WHERE LOWER(category) = LOWER(?)';
      let placeParams = [selectedCat];
      if (selectedCat === 'Movies') {
        placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('movie', 'movies')";
        placeParams = [];
      } else if (selectedCat === 'Web Series') {
        placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('series', 'web series', 'tv series', 'tv')";
        placeParams = [];
      } else if (selectedCat === 'Anime') {
        placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('anime', 'animation', 'animation movies')";
        placeParams = [];
      }

      db.all(placeSql, placeParams, (errP, placements) => {
        const occupiedHP = {};
        const occupiedGrid = {};
        const hpMap = {};
        const gridMap = {};

        (placements || []).forEach(p => {
          const vObj = (videos || []).find(v => v.id === p.video_id);
          const vTitle = vObj ? vObj.title : p.video_id;
          if (p.slot_type === 'homepage') {
            occupiedHP[p.position] = { id: p.video_id, title: vTitle };
            hpMap[p.video_id] = p.position;
          } else if (p.slot_type === 'grid') {
            occupiedGrid[p.position] = { id: p.video_id, title: vTitle };
            gridMap[p.video_id] = p.position;
          }
        });

        // Set homepage_section & grid_position for each video based on active selectedCat placements
        (videos || []).forEach(v => {
          v.homepage_section = hpMap[v.id] || v.homepage_section || 'none';
          v.grid_position = gridMap[v.id] || v.grid_position || 'none';
        });

        const totalVideos = videos.length;
        const movieVideos = (videos || []).filter(v => (v.category || '').toLowerCase().includes('movie') || (v.category || '').toLowerCase().includes('film'));
        const seriesVideos = (videos || []).filter(v => (v.category || '').toLowerCase().includes('series') || (v.category || '').toLowerCase().includes('tv') || (v.category || '').toLowerCase().includes('show'));
        const animeVideos = (videos || []).filter(v => (v.category || '').toLowerCase().includes('anime') || (v.category || '').toLowerCase().includes('toon'));
        const otherVideos = (videos || []).filter(v => {
          const cat = (v.category || '').toLowerCase();
          const isMovie = cat.includes('movie') || cat.includes('film');
          const isSeries = cat.includes('series') || cat.includes('tv') || cat.includes('show');
          const isAnime = cat.includes('anime') || cat.includes('toon');
          return !isMovie && !isSeries && !isAnime;
        });

        const totalMovies = movieVideos.length;
        const totalSeries = seriesVideos.length;
        const totalAnime = animeVideos.length;
        const totalOther = otherVideos.length;
        const totalUsers = userCount > 0 ? userCount + 1242 : 1243;
        const rawViews = (videos || []).reduce((sum, v) => sum + (v.views || 0), 0);
        const totalViews = rawViews > 0 ? rawViews : 56800;
        const totalLikes = (videos || []).reduce((sum, v) => sum + (v.likes || 0), 0);
        const errorMsg = req.query.error || null;
        const successMsg = req.query.success || null;

        // Filter displayed videos based on selectedCat query
        let filteredVideos = videos || [];
        const catLower = (selectedCat || 'all').toLowerCase();
        if (catLower === 'all') {
          filteredVideos = videos || [];
        } else if (catLower === 'movie' || catLower === 'movies') {
          filteredVideos = movieVideos;
        } else if (catLower === 'series' || catLower === 'web series' || catLower === 'tv') {
          filteredVideos = seriesVideos;
        } else if (catLower === 'anime') {
          filteredVideos = animeVideos;
        } else if (catLower === 'categories' || catLower === 'category' || catLower === 'other') {
          filteredVideos = otherVideos;
        } else {
          filteredVideos = (videos || []).filter(v => {
            const vCat = (v.category || '').trim().toLowerCase();
            const target = catLower.trim();
            return vCat === target || vCat.replace(/\s+/g, '-') === target.replace(/\s+/g, '-') || vCat.includes(target) || target.includes(vCat);
          });
        }

        db.all('SELECT * FROM categories ORDER BY display_order ASC, name ASC', [], (errCat, categoriesList) => {
          db.all('SELECT * FROM browse_catalog ORDER BY slot_index ASC', [], (errCatSlots, browseCatalogItems) => {
            db.all('SELECT * FROM custom_sections ORDER BY display_order ASC, created_at ASC', [], (errSec, customSectionsList) => {
              const now = new Date();
              const dateOptions = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
              const formattedDate = now.toLocaleDateString('en-GB', dateOptions);
              const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

              res.render('admin_dashboard', {
                title: 'Admin Control Center - QueTue',
                videos: filteredVideos,
                allVideos: videos || [],
                usersList: usersList || [],
                categoriesList: categoriesList || [],
                browseCatalogItems: browseCatalogItems || [],
                customSectionsList: customSectionsList || [],
                allVideosCount: totalVideos,
                selectedCat,
                selectedSection,
                sectionMode,
                occupiedHP,
                occupiedGrid,
                error: errorMsg,
                success: successMsg,
                stats: { totalVideos, totalMovies, totalSeries, totalAnime, totalOther, totalUsers, totalViews, totalLikes },
                formattedDate,
                formattedTime
              });
            });
          });
        });
      });
    });
  });
});

// POST /admin249/update-homepage-section/:id
router.post('/update-homepage-section/:id', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  const hpSection = req.body.homepage_section || req.body.section || 'none';
  let cat = req.body.cat || req.query.cat || 'All';
  const redirectSection = req.body.redirect_section || req.body.section || req.query.section || null;

  const isHeroPlacement = (hpSection === 'hero_main' || hpSection === 'position2' || hpSection === 'position3' || hpSection === 'position4');

  const getRedirectUrl = () => {
    let url = `/admin249/dashboard?cat=${encodeURIComponent(cat)}`;
    if (redirectSection) {
      url += `&section=${encodeURIComponent(redirectSection)}#section-view-area`;
    }
    return url;
  };

  if (isHeroPlacement) {
    db.run(
      'DELETE FROM category_placements WHERE (LOWER(category) = LOWER(?) OR (LOWER(?) = "movies" AND LOWER(category) IN ("movie", "movies")) OR (LOWER(?) = "web series" AND LOWER(category) IN ("series", "web series", "tv series", "tv"))) AND slot_type = ? AND position = ?',
      [cat, cat, cat, 'homepage', hpSection],
      () => {
        db.run(
          'DELETE FROM category_placements WHERE (LOWER(category) = LOWER(?) OR (LOWER(?) = "movies" AND LOWER(category) IN ("movie", "movies")) OR (LOWER(?) = "web series" AND LOWER(category) IN ("series", "web series", "tv series", "tv"))) AND slot_type = ? AND video_id = ?',
          [cat, cat, cat, 'homepage', videoId],
          () => {
            db.run(
              'INSERT INTO category_placements (category, slot_type, position, video_id) VALUES (?, ?, ?, ?)',
              [cat, 'homepage', hpSection, videoId],
              () => res.redirect(getRedirectUrl())
            );
          }
        );
      }
    );
  } else {
    // If not a Hero placement (e.g. 'trending', 'recommended', custom section key, or 'none')
    // Update videos table directly!
    db.run(
      'UPDATE videos SET homepage_section = ?, section = ? WHERE id = ?',
      [hpSection, hpSection, videoId],
      (err) => {
        if (err) console.error("DB update homepage_section error:", err);
        res.redirect(getRedirectUrl());
      }
    );
  }
});

// POST /admin249/update-grid-position/:id
router.post('/update-grid-position/:id', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  const gridPos = req.body.grid_position || req.body.section || 'none';
  let cat = req.body.cat || req.query.cat || 'All';
  const cLower = cat.toLowerCase().trim();
  if (cLower === 'movie' || cLower === 'movies') cat = 'Movies';
  else if (cLower === 'series' || cLower === 'web series' || cLower === 'tv') cat = 'Web Series';
  else if (cLower === 'anime' || cLower === 'animation') cat = 'Anime';

  if (gridPos !== 'none') {
    db.run(
      'DELETE FROM category_placements WHERE (LOWER(category) = LOWER(?) OR (LOWER(?) = "movies" AND LOWER(category) IN ("movie", "movies")) OR (LOWER(?) = "web series" AND LOWER(category) IN ("series", "web series", "tv series", "tv"))) AND slot_type = ? AND position = ?',
      [cat, cat, cat, 'grid', gridPos],
      () => {
        db.run(
          'DELETE FROM category_placements WHERE (LOWER(category) = LOWER(?) OR (LOWER(?) = "movies" AND LOWER(category) IN ("movie", "movies")) OR (LOWER(?) = "web series" AND LOWER(category) IN ("series", "web series", "tv series", "tv"))) AND slot_type = ? AND video_id = ?',
      [cat, cat, cat, 'grid', videoId],
          () => {
            db.run(
              'INSERT INTO category_placements (category, slot_type, position, video_id) VALUES (?, ?, ?, ?)',
              [cat, 'grid', gridPos, videoId],
              (err) => {
                res.redirect(`/admin249/dashboard?cat=${encodeURIComponent(cat)}`);
              }
            );
          }
        );
      }
    );
  } else {
    db.run(
      'DELETE FROM category_placements WHERE (LOWER(category) = LOWER(?) OR (LOWER(?) = "movies" AND LOWER(category) IN ("movie", "movies")) OR (LOWER(?) = "web series" AND LOWER(category) IN ("series", "web series", "tv series", "tv"))) AND slot_type = ? AND video_id = ?',
      [cat, cat, cat, 'grid', videoId],
      (err) => {
        res.redirect(`/admin249/dashboard?cat=${encodeURIComponent(cat)}`);
      }
    );
  }
});

// POST/GET /admin249/update-section/:id (Backwards Compatibility)
const handleUpdateSection = (req, res) => {
  const videoId = req.params.id;
  const section = req.body.section || req.query.section;
  const cat = req.body.cat || req.query.cat || 'All';
  const allowedSections = ['hero_main', 'position2', 'position3', 'position4', 'hero_grid', 'grid_1', 'grid_2', 'grid_3', 'grid_4', 'recommended', 'none'];

  if (!section || !allowedSections.includes(section)) {
    return res.redirect(`/admin249/dashboard?cat=${encodeURIComponent(cat)}`);
  }

  const isGrid = section.startsWith('grid_') || section === 'hero_grid';
  const slotType = isGrid ? 'grid' : 'homepage';

  if (section !== 'none') {
    db.run('DELETE FROM category_placements WHERE LOWER(category) = LOWER(?) AND slot_type = ? AND (position = ? OR video_id = ?)', [cat, slotType, section, videoId], () => {
      db.run('INSERT INTO category_placements (category, slot_type, position, video_id) VALUES (?, ?, ?, ?)', [cat, slotType, section, videoId], () => {
        res.redirect(`/admin249/dashboard?cat=${encodeURIComponent(cat)}`);
      });
    });
  } else {
    db.run('DELETE FROM category_placements WHERE LOWER(category) = LOWER(?) AND slot_type = ? AND video_id = ?', [cat, slotType, videoId], () => {
      res.redirect(`/admin249/dashboard?cat=${encodeURIComponent(cat)}`);
    });
  }
};

router.post('/update-section/:id', requireAdmin, handleUpdateSection);
router.get('/update-section/:id', requireAdmin, handleUpdateSection);

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const uploadDir = path.join(__dirname, '../public/uploads');
const thumbDir = path.join(uploadDir, 'thumbnails');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, thumbDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

function transformGoogleDriveUrl(url, isDownload = false) {
  if (!url || typeof url !== 'string') return url;
  const str = url.trim();

  if (str.includes('drive.google.com') || str.includes('docs.google.com')) {
    let fileId = null;
    const match1 = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match1 && match1[1]) fileId = match1[1];

    if (!fileId) {
      const match2 = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match2 && match2[1]) fileId = match2[1];
    }

    if (fileId) {
      if (isDownload) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      } else {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
      }
    }
  }

  return str;
}

// POST /admin249/delete-video/:id
router.post('/delete-video/:id', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  db.deleteVideoCompletely(videoId, (err) => {
    if (err) {
      console.error('Failed to delete video completely:', err);
    }
    res.redirect('/admin249/dashboard');
  });
});

// GET /admin249/edit-video/:id (Render Edit Post Studio)
router.get('/edit-video/:id', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, video) => {
    if (err || !video) {
      return res.redirect('/admin249/dashboard?error=Video not found.');
    }

    db.all('SELECT * FROM videos', [], (err2, videos) => {
      const occupiedHP = {};
      const occupiedGrid = {};

      (videos || []).forEach(v => {
        if (v.id === videoId) return;
        const hp = v.homepage_section || (v.section && !v.section.startsWith('grid_') && v.section !== 'hero_grid' ? v.section : null);
        if (hp && hp !== 'none') occupiedHP[hp] = { id: v.id, title: v.title };

        const grid = v.grid_position || (v.section && (v.section.startsWith('grid_') || v.section === 'hero_grid') ? v.section : null);
        if (grid && grid !== 'none') occupiedGrid[grid] = { id: v.id, title: v.title };
      });

      res.render('edit_video', {
        title: `Edit Post (${video.title}) - Admin Studio`,
        video,
        occupiedHP,
        occupiedGrid
      });
    });
  });
});

// POST /admin249/update-video/:id (Handle Post Field Updates)
router.post('/update-video/:id', requireAdmin, upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'main_image', maxCount: 1 },
  { name: 'mobile_image', maxCount: 1 },
  { name: 'sidebar_image', maxCount: 1 }
]), (req, res) => {
  const videoId = req.params.id;

  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, existing) => {
    if (err || !existing) {
      return res.redirect('/admin249/dashboard?error=Post not found for update.');
    }

    const {
      title, movie_name, description, category, homepage_section, grid_position,
      tags, image_url, main_image_url, mobile_image_url, sidebar_image_url, duration,
      release_date, language, short_about, size, quality, video_url, bio_label_type
    } = req.body;

    const updatedTitle = (title && title.trim()) ? title.trim() : existing.title;
    const updatedMovieName = (movie_name && movie_name.trim()) ? movie_name.trim() : (existing.movie_name || updatedTitle);
    const updatedShortAbout = (short_about !== undefined) ? short_about.trim() : (existing.short_about || '');
    const updatedDescription = (description !== undefined) ? description.trim() : (existing.description || '');
    const updatedCategory = (category && category.trim()) ? category.trim() : (existing.category || 'Movie');
    const updatedHpSec = (homepage_section !== undefined) ? homepage_section : (existing.homepage_section || 'none');
    const updatedGridPos = (grid_position !== undefined) ? grid_position : (existing.grid_position || 'none');
    const updatedDuration = (duration !== undefined) ? duration.trim() : (existing.duration || '');
    const updatedReleaseDate = (release_date !== undefined) ? release_date.trim() : (existing.release_date || '');
    const updatedLanguage = (language !== undefined) ? language.trim() : (existing.language || '');
    const updatedSize = (size !== undefined) ? size.trim() : (existing.size || '');
    const updatedQuality = (quality !== undefined) ? quality.trim() : (existing.quality || '');
    const updatedTags = (tags !== undefined) ? tags.trim() : (existing.tags || '');
    const updatedBioLabelType = (bio_label_type !== undefined) ? bio_label_type.trim() : (existing.bio_label_type || 'Bio');

    const rawDownloadUrl = (video_url && video_url.trim()) ? video_url.trim() : (existing.video_url || '#');
    const updatedVideoUrl = transformGoogleDriveUrl(rawDownloadUrl, true);

    let updatedThumbnailUrl = existing.thumbnail_url;
    if (image_url && image_url.trim()) {
      updatedThumbnailUrl = transformGoogleDriveUrl(image_url.trim(), false);
    }
    if (req.files && req.files.thumbnail && req.files.thumbnail[0] && req.files.thumbnail[0].size > 0) {
      updatedThumbnailUrl = `/uploads/thumbnails/${req.files.thumbnail[0].filename}`;
    }

    let updatedMainImageUrl = existing.main_image_url || updatedThumbnailUrl;
    if (main_image_url && main_image_url.trim()) {
      updatedMainImageUrl = transformGoogleDriveUrl(main_image_url.trim(), false);
    }
    if (req.files && req.files.main_image && req.files.main_image[0] && req.files.main_image[0].size > 0) {
      updatedMainImageUrl = `/uploads/thumbnails/${req.files.main_image[0].filename}`;
    }

    let updatedMobileImageUrl = existing.mobile_image_url || updatedThumbnailUrl;
    if (mobile_image_url && mobile_image_url.trim()) {
      updatedMobileImageUrl = transformGoogleDriveUrl(mobile_image_url.trim(), false);
    }
    if (req.files && req.files.mobile_image && req.files.mobile_image[0] && req.files.mobile_image[0].size > 0) {
      updatedMobileImageUrl = `/uploads/thumbnails/${req.files.mobile_image[0].filename}`;
    }

    let updatedSidebarImageUrl = existing.sidebar_image_url || updatedThumbnailUrl;
    if (sidebar_image_url && sidebar_image_url.trim()) {
      updatedSidebarImageUrl = transformGoogleDriveUrl(sidebar_image_url.trim(), false);
    }
    if (req.files && req.files.sidebar_image && req.files.sidebar_image[0] && req.files.sidebar_image[0].size > 0) {
      updatedSidebarImageUrl = `/uploads/thumbnails/${req.files.sidebar_image[0].filename}`;
    }

    db.run(
      `UPDATE videos SET 
        title = ?, 
        movie_name = ?, 
        short_about = ?, 
        description = ?, 
        video_url = ?, 
        thumbnail_url = ?, 
        main_image_url = ?, 
        mobile_image_url = ?, 
        sidebar_image_url = ?, 
        category = ?, 
        homepage_section = ?, 
        grid_position = ?, 
        duration = ?, 
        release_date = ?, 
        language = ?, 
        size = ?, 
        quality = ?, 
        tags = ?,
        bio_label_type = ? 
       WHERE id = ?`,
      [
        updatedTitle,
        updatedMovieName,
        updatedShortAbout,
        updatedDescription,
        updatedVideoUrl,
        updatedThumbnailUrl,
        updatedMainImageUrl,
        updatedMobileImageUrl,
        updatedSidebarImageUrl,
        updatedCategory,
        updatedHpSec,
        updatedGridPos,
        updatedDuration,
        updatedReleaseDate,
        updatedLanguage,
        updatedSize,
        updatedQuality,
        updatedTags,
        updatedBioLabelType,
        videoId
      ],
      (err2) => {
        if (err2) {
          console.error("DB Update error:", err2);
          return res.status(500).send('Database error updating content post.');
        }

        // Sync update with db/uploads_store.json
        uploadStore.saveUpload({
          id: videoId,
          title: updatedTitle,
          movie_name: updatedMovieName,
          short_about: updatedShortAbout,
          description: updatedDescription,
          video_url: updatedVideoUrl,
          thumbnail_url: updatedThumbnailUrl,
          main_image_url: updatedMainImageUrl,
          mobile_image_url: updatedMobileImageUrl,
          sidebar_image_url: updatedSidebarImageUrl,
          category: updatedCategory,
          homepage_section: updatedHpSec,
          grid_position: updatedGridPos,
          duration: updatedDuration,
          release_date: updatedReleaseDate,
          language: updatedLanguage,
          size: updatedSize,
          quality: updatedQuality,
          tags: updatedTags
        });

        res.redirect('/admin249/dashboard?success=Post+updated+successfully');
      }
    );
  });
});

// GET /admin249/update-video/:id (Fallback redirect to Edit Studio)
router.get('/update-video/:id', requireAdmin, (req, res) => {
  res.redirect(`/admin249/edit-video/${req.params.id}`);
});

// POST /admin249/categories/add (Add New Category)
router.post('/categories/add', requireAdmin, (req, res) => {
  const { name, slug, image_url } = req.body;
  if (!name || !name.trim()) {
    return res.redirect('/admin249/dashboard?cat=Categories&error=Category Name is required.');
  }

  const catName = name.trim();
  const catSlug = (slug && slug.trim()) ? slug.trim() : catName;
  const catImg = (image_url && image_url.trim()) ? image_url.trim() : '';
  const catId = `cat_${uuidv4().substring(0, 8)}`;

  db.run(
    'INSERT INTO categories (id, name, slug, image_url) VALUES (?, ?, ?, ?)',
    [catId, catName, catSlug, catImg],
    (err) => {
      if (err) {
        console.error("DB Add Category error:", err);
        return res.redirect('/admin249/dashboard?cat=Categories&error=Category already exists or DB error.');
      }
      res.redirect('/admin249/dashboard?cat=Categories');
    }
  );
});

// POST /admin249/categories/edit/:id (Edit Category)
router.post('/categories/edit/:id', requireAdmin, (req, res) => {
  const catId = req.params.id;
  const { name, slug, image_url } = req.body;

  if (!name || !name.trim()) {
    return res.redirect('/admin249/dashboard?cat=Categories&error=Category Name cannot be empty.');
  }

  const catName = name.trim();
  const catSlug = (slug && slug.trim()) ? slug.trim() : catName;
  const catImg = (image_url && image_url.trim()) ? image_url.trim() : '';

  db.run(
    'UPDATE categories SET name = ?, slug = ?, image_url = ? WHERE id = ?',
    [catName, catSlug, catImg, catId],
    (err) => {
      if (err) {
        console.error("DB Edit Category error:", err);
        return res.redirect('/admin249/dashboard?cat=Categories&error=Failed to update category.');
      }
      res.redirect('/admin249/dashboard?cat=Categories');
    }
  );
});

// POST /admin249/categories/toggle-sidebar/:id (Toggle Sidebar / Browse Catalog Visibility)
router.post('/categories/toggle-sidebar/:id', requireAdmin, (req, res) => {
  const catId = req.params.id;
  db.run('UPDATE categories SET in_sidebar = CASE WHEN in_sidebar = 1 THEN 0 ELSE 1 END WHERE id = ?', [catId], (err) => {
    if (err) {
      console.error("DB Toggle Category Sidebar error:", err);
    }
    res.redirect('/admin249/dashboard?cat=Categories');
  });
});

// POST /admin249/categories/delete/:id (Delete Category)
router.post('/categories/delete/:id', requireAdmin, (req, res) => {
  const catId = req.params.id;
  db.run('DELETE FROM categories WHERE id = ?', [catId], (err) => {
    if (err) {
      console.error("DB Delete Category error:", err);
    }
    res.redirect('/admin249/dashboard?cat=Categories');
  });
});

// POST /admin249/sections/add (Add New Custom Homepage Section)
router.post('/sections/add', requireAdmin, (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.redirect('/admin249/dashboard?cat=Decorate%20Videos&error=Section Title is required.');
  }

  const secTitle = title.trim();
  const secKey = secTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const secId = `sec_${uuidv4().substring(0, 8)}`;

  db.run(
    'INSERT INTO custom_sections (id, title, section_key) VALUES (?, ?, ?)',
    [secId, secTitle, secKey],
    (err) => {
      if (err) {
        console.error("DB Add Section error:", err);
        return res.redirect('/admin249/dashboard?cat=Decorate%20Videos&error=Section already exists or DB error.');
      }
      res.redirect('/admin249/dashboard?cat=Decorate%20Videos');
    }
  );
});

// POST /admin249/sections/delete/:id (Delete Custom Section)
router.post('/sections/delete/:id', requireAdmin, (req, res) => {
  const secId = req.params.id;
  db.run('DELETE FROM custom_sections WHERE id = ?', [secId], (err) => {
    if (err) {
      console.error("DB Delete Section error:", err);
    }
    res.redirect('/admin249/dashboard?cat=Decorate%20Videos');
  });
});

// POST /admin249/sections/assign-videos (Bulk assign/unassign selected videos for a section)
router.post('/sections/assign-videos', requireAdmin, (req, res) => {
  const { section_key, video_ids } = req.body;
  if (!section_key) {
    return res.redirect('/admin249/dashboard?cat=Decorate%20Videos&error=Invalid section.');
  }

  let selectedIds = [];
  if (Array.isArray(video_ids)) {
    selectedIds = video_ids.filter(id => id && typeof id === 'string' && id.trim());
  } else if (typeof video_ids === 'string' && video_ids.trim()) {
    selectedIds = [video_ids.trim()];
  }

  db.all('SELECT id FROM videos WHERE homepage_section = ? OR section = ?', [section_key, section_key], (err, currentSectionVideos) => {
    const currentIds = (currentSectionVideos || []).map(v => v.id);

    const idsToAdd = selectedIds.filter(id => !currentIds.includes(id));
    const idsToRemove = currentIds.filter(id => !selectedIds.includes(id));

    const updateAdd = (cb) => {
      if (idsToAdd.length === 0) return cb();
      const placeholders = idsToAdd.map(() => '?').join(',');
      db.run(
        `UPDATE videos SET homepage_section = ?, section = ? WHERE id IN (${placeholders})`,
        [section_key, section_key, ...idsToAdd],
        cb
      );
    };

    const updateRemove = (cb) => {
      if (idsToRemove.length === 0) return cb();
      const placeholders = idsToRemove.map(() => '?').join(',');
      db.run(
        `UPDATE videos SET homepage_section = 'none', section = 'none' WHERE id IN (${placeholders})`,
        idsToRemove,
        cb
      );
    };

    updateAdd(() => {
      updateRemove(() => {
        res.redirect(`/admin249/dashboard?cat=Decorate%20Videos&section=${encodeURIComponent(section_key)}#section-view-area`);
      });
    });
  });
});

module.exports = { router, requireAdmin };
