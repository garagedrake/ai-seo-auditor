# SEO Domain Analyzer (2026 Edition) 🕸️✨

A standalone, extremely powerful analysis tool written in Node.js to evaluate websites based on tomorrow's (SGE / AI Overviews) search algorithms as well as fundamental on-page ranking factors. The tool has the ability to crawl an entire domain recursively up to 100 subpages and spit out a categorized actionable list in real-time over SSE (Server-Sent Events).

## 🚀 Features
* **Recursive Domain Spider:** Enter a crawl depth (e.g., Page + Subpages) and the spider (Puppeteer/BFS) will find internal links and evaluate the entire domain asynchronously.
* **Master Action Plan:** The final report is not an average; all failed tests from all crawled subpages are combined and sorted by *Critical, Medium or Low* priority. You always know exactly *which* subpage is failing.
* **Live Terminal:** See logs flowing down the minimalist frontend interface second by second during the analysis.
* **AI & GEO (Generative Engine Optimization):** Measures technical Core Web Vitals (DOM Bloat) and factors for LLM models such as Information Gain and existing "Atomic Answers" / TL;DR.
* **Grouped History:** Saves all the tests you have run and builds interactive accordions grouped by domain name to quickly look back at progress.

## 🛠️ Installation & Start

### 1. Clone the repo and install
The environment is primarily driven by `puppeteer` and `express`. Ensure that you have [Node.js](https://nodejs.org/) installed.

```bash
git clone https://github.com/your-username/ai-seo-auditor.git
cd ai-seo-auditor
npm install
```

### 2. Start the background server
```bash
node server.js
```

### 3. Run the analysis
Open your browser (Chrome, Safari, Firefox etc.) and navigate to the gem:
**[http://localhost:3000](http://localhost:3000)**

Enter any URL, adjust the limits and press Start Crawling!

---
*Developed as an open-source project to give web developers modern conditions for the search of the future.*
