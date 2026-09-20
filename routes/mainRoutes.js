const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { v4: uuidv4 } = require('uuid');

// Homepage with flexible OTT category filtering
router.get('/', (req, res) => {
  const category = req.query.category;
  let sql = 'SELECT * FROM videos ORDER BY created_at DESC';
  let params = [];

  if (category && category !== 'All' && category !== 'Popular' && category !== 'Dynamic') {
    const rawCat = decodeURIComponent(category).trim();
    const cleanLower = rawCat.toLowerCase().trim();

    if (cleanLower === 'movie' || cleanLower === 'movies') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%movie%' OR LOWER(category) LIKE '%film%' OR LOWER(category) = 'movie' OR LOWER(category) = 'movies' ORDER BY created_at DESC`;
      params = [];
    } else if (cleanLower === 'tv' || cleanLower === 'web series' || cleanLower === 'tv series' || cleanLower === 'series') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%series%' OR LOWER(category) LIKE '%tv%' OR LOWER(category) LIKE '%show%' ORDER BY created_at DESC`;
      params = [];
    } else if (cleanLower === 'anime' || cleanLower === 'animation' || cleanLower === 'animation movies' || cleanLower === 'anime & toons' || cleanLower === 'toons') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%anime%' OR LOWER(category) LIKE '%animat%' OR LOWER(category) LIKE '%toon%' ORDER BY created_at DESC`;
      params = [];
    } else if (cleanLower === 'game' || cleanLower === 'gaming' || cleanLower === 'gaming & sports' || cleanLower === 'sports') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%game%' OR LOWER(category) LIKE '%gaming%' OR LOWER(category) LIKE '%sport%' ORDER BY created_at DESC`;
      params = [];
    } else if (cleanLower === 'music' || cleanLower === 'music & shows') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%music%' OR LOWER(category) LIKE '%song%' OR LOWER(category) LIKE '%show%' ORDER BY created_at DESC`;
      params = [];
    } else if (cleanLower === 'documentary') {
      sql = `SELECT * FROM videos WHERE LOWER(category) LIKE '%documentary%' OR LOWER(category) LIKE '%docu%' ORDER BY created_at DESC`;
      params = [];
    } else {
      // Dynamic category search for sub-categories or new Admin-added categories (e.g. /?category=Bollywood%20Movies or /?category=Action)
      sql = 'SELECT * FROM videos WHERE LOWER(category) LIKE ? OR LOWER(category) = ? ORDER BY created_at DESC';
      params = [`%${cleanLower}%`, cleanLower];
    }
  }

  db.all(sql, params, (err, videos) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).send('Database error');
    }
    const videoList = videos || [];
    const activeCategory = category || 'All';
    const cleanLower = activeCategory.toLowerCase().trim();

    let placeSql = 'SELECT * FROM category_placements WHERE LOWER(category) = LOWER(?)';
    let placeParams = [activeCategory];

    if (cleanLower === 'movie' || cleanLower === 'movies') {
      placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('movie', 'movies')";
      placeParams = [];
    } else if (cleanLower === 'tv' || cleanLower === 'web series' || cleanLower === 'tv series' || cleanLower === 'series') {
      placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('series', 'web series', 'tv series', 'tv')";
      placeParams = [];
    } else if (cleanLower === 'anime' || cleanLower === 'animation' || cleanLower === 'animation movies') {
      placeSql = "SELECT * FROM category_placements WHERE LOWER(category) IN ('anime', 'animation', 'animation movies')";
      placeParams = [];
    }

    db.all(placeSql, placeParams, (errP, placements) => {
      const catPlacements = placements || [];

      const hpMap = {};
      const gridMap = {};
      catPlacements.forEach(p => {
        if (p.slot_type === 'homepage') hpMap[p.video_id] = p.position;
        if (p.slot_type === 'grid') gridMap[p.video_id] = p.position;
      });

      videoList.forEach((v) => {
        v.homepage_section = hpMap[v.id] || v.homepage_section || 'none';
        v.grid_position = gridMap[v.id] || v.grid_position || 'none';
        v.thumbnail_url = transformGoogleDriveUrl(v.thumbnail_url, false);
        if (v.main_image_url) v.main_image_url = transformGoogleDriveUrl(v.main_image_url, false);
        if (v.sidebar_image_url) v.sidebar_image_url = transformGoogleDriveUrl(v.sidebar_image_url, false);
      });

      db.all('SELECT * FROM categories ORDER BY display_order ASC, name ASC', [], (errCat, categoriesList) => {
        res.render('index', { 
          videos: videoList,
          categoriesList: categoriesList || [], 
          query: '', 
          selectedCategory: activeCategory
        });
      });
    });
  });
});

// Public login/signup disabled - redirect to homepage
router.get('/login', (req, res) => res.redirect('/'));
router.get('/signup', (req, res) => res.redirect('/'));

function transformGoogleDriveUrl(url, isDownload = false) {
  if (!url || typeof url !== 'string') return url;
  const str = url.trim();

  if (str.includes('drive.google.com') || str.includes('docs.google.com')) {
    const match = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      const fileId = match[1];
      if (isDownload) {
        return `https://drive.google.com/uc?export=download&id=${fileId}`;
      } else {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
      }
    }
  }

  return str;
}

// Helper for scoring and ranking search relevance
function scoreVideoForQuery(v, qTrim, tokens) {
  let score = 0;
  const title = (v.title || '').toLowerCase();
  const movieName = (v.movie_name || '').toLowerCase();
  const category = (v.category || '').toLowerCase();
  const tags = (v.tags || '').toLowerCase();
  const shortAbout = (v.short_about || '').toLowerCase();
  const description = (v.description || '').toLowerCase();
  const uploaderName = (v.uploader_name || '').toLowerCase();
  const section = (v.section || '').toLowerCase();
  const hpSection = (v.homepage_section || '').toLowerCase();

  const qLower = qTrim.toLowerCase();

  // Full query exact / prefix / substring match
  if (title === qLower || movieName === qLower) score += 1000;
  else if (title.startsWith(qLower) || movieName.startsWith(qLower)) score += 500;
  else if (title.includes(qLower) || movieName.includes(qLower)) score += 300;

  if (category === qLower) score += 250;
  else if (category.includes(qLower)) score += 150;

  if (tags.includes(qLower)) score += 200;
  if (shortAbout.includes(qLower)) score += 100;
  if (description.includes(qLower)) score += 80;
  if (uploaderName.includes(qLower)) score += 50;
  if (section.includes(qLower) || hpSection.includes(qLower)) score += 40;

  // Individual token matches
  tokens.forEach(tok => {
    if (!tok || tok.length < 2) return;
    if (title.includes(tok) || movieName.includes(tok)) score += 60;
    if (category.includes(tok)) score += 40;
    if (tags.includes(tok)) score += 30;
    if (description.includes(tok)) score += 20;
  });

  return score;
}

// Live Autocomplete / Suggestions API
router.get('/api/search/suggest', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ suggestions: [] });

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  db.all('SELECT * FROM videos', [], (err, allVideos) => {
    if (err || !allVideos) return res.json({ suggestions: [] });

    const scored = allVideos
      .map(v => ({ video: v, score: scoreVideoForQuery(v, q, tokens) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(item => ({
        id: item.video.id,
        title: item.video.title,
        movie_name: item.video.movie_name || item.video.title,
        thumbnail_url: item.video.thumbnail_url,
        category: item.video.category || 'Movie',
        duration: item.video.duration || '03:45',
        rating: item.video.rating || '8.5'
      }));

    res.json({ suggestions: scored });
  });
});

// Main Search Route
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();

  db.all('SELECT * FROM videos ORDER BY created_at DESC', [], (err, allVideos) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Search error');
    }
    const videosList = allVideos || [];

    if (!q) {
      return res.render('search', {
        videos: videosList,
        relatedVideos: [],
        query: '',
        selectedCategory: 'All',
        isSearchPage: true,
        isExplorePage: false
      });
    }

    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

    const scoredItems = videosList
      .map(v => ({ video: v, score: scoreVideoForQuery(v, q, tokens) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const matchedVideos = scoredItems.map(item => item.video);
    const matchedIds = new Set(matchedVideos.map(v => v.id));

    // Find related videos from matching categories/tags, or fallbacks
    let relatedVideos = [];
    if (matchedVideos.length > 0) {
      const topCategories = new Set(matchedVideos.map(v => v.category).filter(Boolean));
      relatedVideos = videosList.filter(v => !matchedIds.has(v.id) && topCategories.has(v.category));
    }

    // If related is still small or no matches, provide popular recommendations
    if (relatedVideos.length < 4) {
      const extraFallback = videosList.filter(v => !matchedIds.has(v.id) && !relatedVideos.some(r => r.id === v.id));
      relatedVideos = relatedVideos.concat(extraFallback);
    }

    res.render('search', {
      videos: matchedVideos,
      relatedVideos: relatedVideos.slice(0, 8),
      query: q,
      selectedCategory: 'All',
      isSearchPage: true,
      isExplorePage: false
    });
  });
});



// Channel Profile Route
router.get('/channel/:id', (req, res) => {
  const channelId = req.params.id;
  db.get('SELECT * FROM users WHERE id = ?', [channelId], (err, user) => {
    if (err || !user) {
      const fallbackUser = {
        id: channelId,
        username: channelId.replace('up_', '').toUpperCase(),
        handle: `@${channelId}`,
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        subscribers: 124000,
        banner: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1200&q=80'
      };
      db.all('SELECT * FROM videos WHERE uploader_id = ? OR uploader_name LIKE ?', [channelId, `%${channelId}%`], (err2, videos) => {
        return res.render('channel', { user: fallbackUser, videos: videos || [] });
      });
    } else {
      db.all('SELECT * FROM videos WHERE uploader_id = ?', [channelId], (err2, videos) => {
        return res.render('channel', { user, videos: videos || [] });
      });
    }
  });
});

module.exports = router;
