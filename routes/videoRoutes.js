const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const uploadStore = require('../db/uploadStore');

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../public/uploads');
const videoDir = path.join(uploadDir, 'videos');
const thumbDir = path.join(uploadDir, 'thumbnails');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

// Multer Disk Storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'video') {
      cb(null, videoDir);
    } else {
      cb(null, thumbDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max limit
});

// Watch Page
router.get('/watch/:id', (req, res) => {
  const videoId = req.params.id;

  // Increment views
  db.run('UPDATE videos SET views = views + 1 WHERE id = ?', [videoId]);

  db.get('SELECT * FROM videos WHERE id = ?', [videoId], (err, video) => {
    if (err || !video) {
      return res.status(404).render('404', { title: 'Video Not Found' });
    }

    video.video_url = transformGoogleDriveUrl(video.video_url, true);
    if (video.thumbnail_url) video.thumbnail_url = transformGoogleDriveUrl(video.thumbnail_url, false);
    if (video.main_image_url) video.main_image_url = transformGoogleDriveUrl(video.main_image_url, false);
    if (video.sidebar_image_url) video.sidebar_image_url = transformGoogleDriveUrl(video.sidebar_image_url, false);

    // Fetch recommended videos
    db.all('SELECT * FROM videos WHERE id != ? ORDER BY views DESC LIMIT 12', [videoId], (err, relatedVideos) => {
      if (err) relatedVideos = [];

      res.render('watch', {
        title: `${video.title} - QueTue`,
        video,
        relatedVideos: relatedVideos || [],
        isWatchPage: true
      });
    });
  });
});

const { requireAdmin } = require('./adminRoutes');

// Render Upload Studio (Admin Only)
router.get('/upload', requireAdmin, (req, res) => {
  db.all('SELECT * FROM videos', [], (err, videos) => {
    const occupiedHP = {};
    const occupiedGrid = {};

    (videos || []).forEach(v => {
      const hp = v.homepage_section || (v.section && !v.section.startsWith('grid_') && v.section !== 'hero_grid' ? v.section : null);
      if (hp && hp !== 'none') {
        occupiedHP[hp] = { id: v.id, title: v.title };
      }

      const grid = v.grid_position || (v.section && (v.section.startsWith('grid_') || v.section === 'hero_grid') ? v.section : null);
      if (grid && grid !== 'none') {
        occupiedGrid[grid] = { id: v.id, title: v.title };
      }
    });

    res.render('upload', { title: 'Upload Video - Admin Studio', occupiedHP, occupiedGrid, isUploadPage: true });
  });
});

// Helper to auto-convert Google Drive shareable URLs into direct view/download links
function transformGoogleDriveUrl(url, isDownload = false) {
  if (!url || typeof url !== 'string') return url;
  const str = url.trim();

  if (str.includes('drive.google.com') || str.includes('docs.google.com')) {
    let fileId = null;

    // Pattern 1: /file/d/FILE_ID/
    const match1 = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match1 && match1[1]) {
      fileId = match1[1];
    }

    // Pattern 2: id=FILE_ID
    if (!fileId) {
      const match2 = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match2 && match2[1]) {
        fileId = match2[1];
      }
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

// Handle Content Upload POST (Admin Only - 4 Image Fields)
router.post('/api/upload', requireAdmin, upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'main_image', maxCount: 1 },
  { name: 'mobile_image', maxCount: 1 },
  { name: 'sidebar_image', maxCount: 1 }
]), (req, res) => {
  try {
    const { title, movie_name, description, category, homepage_section, grid_position, tags, uploader_name, image_url, main_image_url, mobile_image_url, sidebar_image_url, duration, release_date, language, short_about, size, quality, video_url } = req.body;
    const postType = 'image';
    const movieNameVal = (movie_name && movie_name.trim()) ? movie_name.trim() : (title || '');
    const durationVal = (duration && duration.trim()) ? duration.trim() : '';
    const releaseDateVal = (release_date && release_date.trim()) ? release_date.trim() : '';
    const languageVal = (language && language.trim()) ? language.trim() : '';
    const shortAboutVal = (short_about && short_about.trim()) ? short_about.trim() : '';
    const sizeVal = (size && size.trim()) ? size.trim() : '450Mb 740Mb 1.1Gb 2.7Gb 5.5Gb';
    const qualityVal = (quality && quality.trim()) ? quality.trim() : 'PreDvD';
    const rawDownloadUrl = (video_url && video_url.trim()) ? video_url.trim() : '#';
    const downloadMediaUrl = transformGoogleDriveUrl(rawDownloadUrl, true);

    let thumbnailUrl = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80';
    if (image_url && image_url.trim()) {
      thumbnailUrl = transformGoogleDriveUrl(image_url.trim(), false);
    }
    if (req.files && req.files.thumbnail && req.files.thumbnail[0] && req.files.thumbnail[0].size > 0) {
      thumbnailUrl = `/uploads/thumbnails/${req.files.thumbnail[0].filename}`;
    }

    let mainImageUrl = thumbnailUrl;
    if (main_image_url && main_image_url.trim()) {
      mainImageUrl = transformGoogleDriveUrl(main_image_url.trim(), false);
    }
    if (req.files && req.files.main_image && req.files.main_image[0] && req.files.main_image[0].size > 0) {
      mainImageUrl = `/uploads/thumbnails/${req.files.main_image[0].filename}`;
    }

    let mobileImageUrl = thumbnailUrl;
    if (mobile_image_url && mobile_image_url.trim()) {
      mobileImageUrl = transformGoogleDriveUrl(mobile_image_url.trim(), false);
    }
    if (req.files && req.files.mobile_image && req.files.mobile_image[0] && req.files.mobile_image[0].size > 0) {
      mobileImageUrl = `/uploads/thumbnails/${req.files.mobile_image[0].filename}`;
    }

    let sidebarImageUrl = thumbnailUrl;
    if (sidebar_image_url && sidebar_image_url.trim()) {
      sidebarImageUrl = transformGoogleDriveUrl(sidebar_image_url.trim(), false);
    }
    if (req.files && req.files.sidebar_image && req.files.sidebar_image[0] && req.files.sidebar_image[0].size > 0) {
      sidebarImageUrl = `/uploads/thumbnails/${req.files.sidebar_image[0].filename}`;
    }

    const videoUrl = downloadMediaUrl; // Dedicated Media / Movie Download Link

    const id = `v_${uuidv4().substring(0, 8)}`;
    const uploader = uploader_name || 'QueTue Studio';
    const uploaderAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80';

    const hpSec = (homepage_section && homepage_section !== 'none') ? homepage_section : 'none';
    const gridPos = (grid_position && grid_position !== 'none') ? grid_position : 'none';

    db.run(
      `INSERT INTO videos (id, title, movie_name, description, video_url, thumbnail_url, main_image_url, mobile_image_url, sidebar_image_url, category, section, homepage_section, grid_position, tags, uploader_id, uploader_name, uploader_avatar, duration, media_type, release_date, language, short_about, size, quality)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, movieNameVal, description, videoUrl, thumbnailUrl, mainImageUrl, mobileImageUrl, sidebarImageUrl, category || 'General', 'none', hpSec, gridPos, tags || '', 'user_custom', uploader, uploaderAvatar, durationVal, postType, releaseDateVal, languageVal, shortAboutVal, sizeVal, qualityVal],
      (err) => {
        if (err) {
          console.error("DB Insert error:", err);
          return res.status(500).send('Database error saving content post.');
        }

        // Store upload payload in db/uploads_store.json file
        uploadStore.saveUpload({
          id,
          title,
          movie_name: movieNameVal,
          description,
          video_url: videoUrl,
          thumbnail_url: thumbnailUrl,
          main_image_url: mainImageUrl,
          mobile_image_url: mobileImageUrl,
          sidebar_image_url: sidebarImageUrl,
          category: category || 'General',
          homepage_section: hpSec,
          grid_position: gridPos,
          tags: tags || '',
          uploader_name: uploader,
          duration: durationVal,
          release_date: releaseDateVal,
          language: languageVal,
          short_about: shortAboutVal,
          size: sizeVal,
          quality: qualityVal,
          uploaded_at: new Date().toISOString()
        });

        res.redirect('/admin249/dashboard');
      }
    );
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send('Server upload error');
  }
});

// API: Post Danmaku (Bullet comment)
router.post('/api/video/:id/danmaku', (req, res) => {
  const videoId = req.params.id;
  const { text, color, timestamp, user_name } = req.body;

  if (!text || timestamp === undefined) {
    return res.status(400).json({ error: 'Text and timestamp required' });
  }

  const dId = `d_${uuidv4().substring(0, 8)}`;
  const userName = user_name || 'Anonymous';
  const dColor = color || '#00e5ff';
  const ts = parseFloat(timestamp);

  db.run(
    `INSERT INTO danmaku (id, video_id, user_name, text, color, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    [dId, videoId, userName, text, dColor, ts],
    (err) => {
      if (err) return res.status(500).json({ error: 'Failed to insert danmaku' });

      // Emit Danmaku over Socket.io if attached
      const io = req.app.get('io');
      if (io) {
        io.to(`video_${videoId}`).emit('new_danmaku', {
          id: dId,
          text,
          color: dColor,
          timestamp: ts,
          user_name: userName
        });
      }

      res.json({ success: true, danmaku: { id: dId, text, color: dColor, timestamp: ts, user_name: userName } });
    }
  );
});



// API: Delete Video Completely (Admin Only)
router.post('/api/video/:id/delete', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  db.deleteVideoCompletely(videoId, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete video' });
    res.json({ success: true, message: 'Video deleted completely from DB and store' });
  });
});

router.delete('/api/video/:id', requireAdmin, (req, res) => {
  const videoId = req.params.id;
  db.deleteVideoCompletely(videoId, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to delete video' });
    res.json({ success: true, message: 'Video deleted completely from DB and store' });
  });
});

module.exports = router;
