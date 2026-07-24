// dev-server.js — run the Express API locally (Vercel runs api/index.js directly).
import 'dotenv/config';
import app from './api/index.js';

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
