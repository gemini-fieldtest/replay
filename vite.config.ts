import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'save-track-middleware',
      configureServer(server) {
        server.middlewares.use('/api/save-track', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const filePath = path.resolve(__dirname, 'public/tracks/thunderhill/points.json');
                // Validate JSON
                JSON.parse(body);
                fs.writeFileSync(filePath, body);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('Error saving file:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to save file' }));
              }
            });
          } else {
            next();
          }
        });
      }
    }
  ],
  base: '/',
})
