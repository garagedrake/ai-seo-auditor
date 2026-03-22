import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeUrl, validateKnowledgeBase } from './src/seo_analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const reportsDir = path.join(__dirname, 'reports');
if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir);
}

app.get('/api/status', (req, res) => {
    try {
        const status = validateKnowledgeBase();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SSE endpoint for Real-time feedback & Deep-crawling
app.get('/api/analyze-stream', async (req, res) => {
    const { url, depth } = req.query;
    const maxDepth = parseInt(depth) || 0;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!url) {
        res.write(`data: ${JSON.stringify({ error: 'No URL provided.' })}\n\n`);
        return res.end();
    }

    const sendProgress = (msg) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', message: msg })}\n\n`);
    };

    try {
        const report = await analyzeUrl(url, maxDepth, sendProgress);
        
        const reportPath = path.join(reportsDir, `${report.id}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        res.write(`data: ${JSON.stringify({ type: 'result', report })}\n\n`);
    } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    } finally {
        res.end();
    }
});

app.get('/api/reports', (req, res) => {
    try {
        const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
        const reports = files.map(file => {
            const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
            return JSON.parse(content);
        });
        reports.sort((a, b) => b.id - a.id);
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/reports', (req, res) => {
    try {
        const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            fs.unlinkSync(path.join(reportsDir, file));
        }
        res.json({ success: true, message: 'All reports cleared.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running! Go to http://localhost:${PORT}`);
});
