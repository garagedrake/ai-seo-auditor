# SEO Domain Analyzer

An analysis tool written in Node.js for evaluating websites based on technical performance (Core Web Vitals) and heuristic markers for LLM readability (SGE/GEO). The tool performs a recursive crawl via Puppeteer and delivers a prioritized action list over SSE.

## Features
* **Recursive Crawling:** Performs Breadth-First Search (BFS) based on the specified depth to analyze internal pages.
* **Action Report:** Compiles technical flaws and structural deviations from all crawled URLs, sorted by priority.
* **Terminal View:** Streams system logs directly in the interface during execution.
* **Heuristic AI Analysis:** Evaluates the presence of LLM-specific structures (`llms.txt`), DOM complexity, and textual markers for "Atomic Answers" and "Information Gain". *Note that text content analysis is performed via keyword heuristics and not through semantic evaluation via an external API.*
* **History:** Saves previous runs locally, grouped by domain.

## Installation & Execution

Requires Node.js.

```bash
git clone https://github.com/garagedrake/ai-seo-auditor.git
cd ai-seo-auditor
npm install
node server.js