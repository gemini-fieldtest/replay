import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../data');
const publicDir = path.join(__dirname, '../public');
const manifestPath = path.join(publicDir, 'manifest.json');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

try {
  const files = fs.readdirSync(dataDir)
    .filter(file => file.endsWith('.csv'))
    .map(file => {
      const filePath = path.join(dataDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        url: `/data/${file}`,
        lastModified: stats.mtime.getTime(),
        size: stats.size
      };
    })
    .sort((a, b) => b.lastModified - a.lastModified); // Sort by newest first

  fs.writeFileSync(manifestPath, JSON.stringify(files, null, 2));
  console.log(`Manifest generated with ${files.length} files at ${manifestPath}`);
} catch (err) {
  console.error('Error generating manifest:', err);
  process.exit(1);
}
