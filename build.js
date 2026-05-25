const fs = require('fs');
const path = require('path');

const files = ['index.html', 'app.js', 'style.css', 'manifest.json', 'sw.js'];
const destDir = path.join(__dirname, 'www');

// Ensure destination directory exists
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Copy each file
files.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(destDir, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Successfully copied ${file} to www/`);
  } else {
    console.warn(`Warning: Source file ${file} does not exist.`);
  }
});
