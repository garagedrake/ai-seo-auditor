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

    // Validate that a URL was provided and that it is parseable
    if (!url) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ error: 'No URL provided.' })}\n\n`);
        return res.end();
    }
    try {
        new URL(url); // throws if invalid
    } catch {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ error: `Invalid URL: "${url}". Please enter a full URL including https://.` })}\n\n`);
        return res.end();
    }

    // Clamp depth to a safe range to prevent abuse
    const rawDepth = parseInt(depth, 10);
    const maxDepth = Number.isFinite(rawDepth) ? Math.min(Math.max(rawDepth, 0), 2) : 0;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (msg) => {
        res.write(`data: ${JSON.stringify({ type: 'progress', message: msg })}\n\n`);
    };

    const controller = new AbortController();
    req.on('close', () => {
        controller.abort();
    });

    try {
        const report = await analyzeUrl(url, maxDepth, sendProgress, controller.signal);

        if (controller.signal.aborted) {
            return; // Don't save or send result if user stopped the crawl
        }

        // Write report to disk (non-fatal if it fails)
        try {
            const reportPath = path.join(reportsDir, `${report.id}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        } catch (writeErr) {
            console.error('Failed to save report to disk:', writeErr.message);
        }

        res.write(`data: ${JSON.stringify({ type: 'result', report })}\n\n`);
    } catch (err) {
        if (!controller.signal.aborted) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        }
    } finally {
        res.end();
    }
});

app.get('/api/reports', (req, res) => {
    try {
        const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('.json'));
        const reports = [];
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(reportsDir, file), 'utf8');
                reports.push(JSON.parse(content));
            } catch (parseErr) {
                // Skip corrupted or unreadable report files
                console.warn(`Skipping corrupted report file: ${file}`, parseErr.message);
            }
        }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running! Go to http://localhost:${PORT}`);
});
