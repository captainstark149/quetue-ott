const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'uploads_store.json');

// Ensure JSON file exists
function initStore() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Get all stored upload entries from db/uploads_store.json
 */
function getStoredUploads() {
  initStore();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading uploads_store.json:", err);
    return [];
  }
}

/**
 * Save a new upload entry to db/uploads_store.json
 */
function saveUpload(videoData) {
  initStore();
  try {
    const uploads = getStoredUploads();
    // Check if item already exists (by id)
    const existingIdx = uploads.findIndex(item => item.id === videoData.id);
    if (existingIdx >= 0) {
      uploads[existingIdx] = { ...uploads[existingIdx], ...videoData };
    } else {
      uploads.push(videoData);
    }
    fs.writeFileSync(filePath, JSON.stringify(uploads, null, 2), 'utf8');
    console.log(`📁 Upload data successfully saved to db/uploads_store.json (ID: ${videoData.id})`);
  } catch (err) {
    console.error("Error saving to uploads_store.json:", err);
  }
}

/**
 * Delete an upload entry from db/uploads_store.json
 */
function deleteUpload(videoId) {
  initStore();
  try {
    let uploads = getStoredUploads();
    uploads = uploads.filter(v => v.id !== videoId);
    fs.writeFileSync(filePath, JSON.stringify(uploads, null, 2), 'utf8');
    console.log(`🗑️ Upload data removed from db/uploads_store.json (ID: ${videoId})`);
  } catch (err) {
    console.error("Error deleting from uploads_store.json:", err);
  }
}

// Auto initialize store file on load
initStore();

module.exports = {
  filePath,
  getStoredUploads,
  saveUpload,
  deleteUpload
};
