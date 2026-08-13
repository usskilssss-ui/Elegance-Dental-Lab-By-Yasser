const fs = require('fs');
const path = require('path');

/**
 * Railway ephemeral disk wipes /uploads on every deploy.
 * Mount a Volume at /data/uploads and set UPLOAD_DIR=/data/uploads.
 */
function getUploadRoot() {
  const fromEnv = String(process.env.UPLOAD_DIR || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(__dirname, '..', 'uploads');
}

function getCasesUploadDir() {
  const dir = path.join(getUploadRoot(), 'cases');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  getUploadRoot,
  getCasesUploadDir,
};
