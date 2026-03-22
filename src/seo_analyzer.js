import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const knowledgePath = path.join(rootDir, 'knowledge', 'seo_guidelines.md');

export function validateKnowledgeBase() {
    if (!fs.existsSync(knowledgePath)) {
        throw new Error('Knowledge base missing: ' + knowledgePath);
    }
    const content = fs.readFileSync(knowledgePath, 'utf8');
    const dateMatch = content.match(/Senast uppdaterad:\s*(\d{4}-\d{2}-\d{2})/i);
    let isOutdated = false;
    let daysOld = 0;

    if (dateMatch) {
        const lastUpdated = new Date(dateMatch[1]);
        const currentDate = new Date();
        const diffTime = currentDate.getTime() - lastUpdated.getTime();
        daysOld = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (daysOld > 180) isOutdated = true;
    }
    return { isOutdated, daysOld };
}

export async function analyzeUrl(startUrl, maxDepth = 0, onProgress = () => {}) {
    let browser;
    const visited = new Set();
    const queue = [{ url: startUrl, depth: 0 }];
    const pagesResults = [];
    const MAX_PAGES = 100; // Increased limit for massive domains based on feedback

    try {
        onProgress(`Launching Headless Crawler... (Goal: Depth ${maxDepth}, Max ${MAX_PAGES} pages)`);
        browser = await puppeteer.launch({ headless: true });
        const startOrigin = new URL(startUrl).origin;

        while (queue.length > 0 && visited.size < MAX_PAGES) {
            const current = queue.shift();
            
            // Clear hashes from URL (e.g. #section) to avoid crawling the same page
            let crawlUrl = current.url;
            try {
                const u = new URL(crawlUrl);
                u.hash = '';
                crawlUrl = u.href;
            } catch(e) { continue; }

            // Avoid duplicate page visits
            if (visited.has(crawlUrl)) continue;
            visited.add(crawlUrl);

            onProgress(`[Depth ${current.depth}] Analyzing: ${crawlUrl.substring(startOrigin.length) || '/'}`);
            
            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(20000); 

            let response;
            try {
                response = await page.goto(crawlUrl, { waitUntil: 'domcontentloaded' });
            } catch (err) {
                onProgress(`Failed to reach ${crawlUrl}: ${err.message}`);
                await page.close();
                continue;
            }

            if (!response || !response.ok()) {
                await page.close();
                continue;
            }

            // 1. Classic SEO & Link extraction
            const classicSeo = await page.evaluate((origin) => {
                const title = document.title;
                const metaDescEl = document.querySelector('meta[name="description"]');
                const metaDesc = metaDescEl ? metaDescEl.content : null;
                const h1s = document.querySelectorAll('h1');
                const canonicalEl = document.querySelector('link[rel="canonical"]');
                const canonical = canonicalEl ? canonicalEl.href : null;
                
                const images = document.querySelectorAll('img');
                let imagesMissingAlt = 0;
                images.forEach(img => {
                    if (!img.hasAttribute('alt') || img.alt.trim() === '') {
                        imagesMissingAlt++;
                    }
                });

                // Pick internal links for breadth-first crawling
                const links = Array.from(document.querySelectorAll('a[href]'))
                    .map(a => a.href)
                    .filter(href => href.startsWith(origin));

                return {
                    title,
                    metaDesc,
                    h1Count: h1s.length,
                    canonical,
                    totalImages: images.length,
                    imagesMissingAlt,
                    internalLinks: links
                };
            }, startOrigin);

            // 2. AI SEO / SGE
            const aiSeo = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                const hasTldr = text.includes('tl;dr') || text.includes('summary') || text.includes('sammanfattning');
                const hasPersonalExperience = text.includes('testade') || text.includes('vår forskning') || text.includes('our research') || text.includes('i tested');
                const domNodesCount = document.querySelectorAll('*').length;
                const scriptsCount = document.querySelectorAll('script').length;
                return { hasTldr, hasPersonalExperience, domNodesCount, scriptsCount };
            });

            // 3. LLMs.txt check (Done quickly for origin, technically only needs to be done once)
            const llmsUrl = `${startOrigin}/llms.txt`;
            let hasLlmsTxt = false;
            try {
                const llmsRes = await fetch(llmsUrl);
                hasLlmsTxt = llmsRes.ok;
            } catch (e) { hasLlmsTxt = false; }

            await page.close();

            // Add new unique links to the queue if we haven't reached max depth
            if (current.depth < maxDepth) {
                const uniqueLinks = [...new Set(classicSeo.internalLinks)];
                for (const link of uniqueLinks) {
                    if (!visited.has(link)) {
                        queue.push({ url: link, depth: current.depth + 1 });
                    }
                }
            }

            pagesResults.push(generatePageData(crawlUrl, classicSeo, aiSeo, hasLlmsTxt));
        }

        await browser.close();
        onProgress(`Crawl completed! Created action plan for ${pagesResults.length} unique pages.`);

        return {
            id: Date.now().toString(),
            url: startUrl,
            domain: startOrigin,
            date: new Date().toISOString(),
            pagesAnalyzed: pagesResults.length,
            pages: pagesResults
        };

    } catch (error) {
        if (browser) await browser.close();
        throw new Error(`${error.message}`);
    }
}

function generatePageData(url, classic, ai, hasLlmsTxt) {
    return {
        url: url,
        categories: {
            classicSeo: {
                title: {
                    passed: classic.title && classic.title.length >= 30 && classic.title.length <= 65,
                    message: classic.title ? `Title: ${classic.title} (${classic.title.length} characters).` : 'Critical flaw: Page lacks <title> or is extremely short.',
                    impact: "High",
                    recommendation: "Write a unique and descriptive <title> tag of 50-60 characters. Fundamental for all existing SEO and SGE.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/title-link"
                },
                metaDescription: {
                    passed: classic.metaDesc && classic.metaDesc.length >= 70 && classic.metaDesc.length <= 160,
                    message: classic.metaDesc ? `Meta Description OK (${classic.metaDesc.length} characters).` : 'Meta Description missing or misses optimal CTR length.',
                    impact: "Low",
                    recommendation: "Write a <meta name='description'> tag of max 160 characters that attracts clicks out on Google's search page.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/snippet"
                },
                h1: {
                    passed: classic.h1Count === 1,
                    message: classic.h1Count === 1 ? 'Exactly one H1 heading found.' : `Incorrect hierarchy. Page has ${classic.h1Count} H1 headings.`,
                    impact: "High",
                    recommendation: "Ensure the subpage has exactly ONE (1) <H1> heading at the top.",
                    sourceUrl: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide#heading-tags"
                },
                canonical: {
                    passed: !!classic.canonical,
                    message: classic.canonical ? 'Canonical link protects against duplicates.' : 'Canonical link missing.',
                    impact: "High",
                    recommendation: "Implement <link rel='canonical' href='...'> in the page's <head>.",
                    sourceUrl: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"
                },
                imagesAlt: {
                    passed: classic.imagesMissingAlt === 0,
                    message: classic.imagesMissingAlt === 0 ? 'All images are fine.' : `${classic.imagesMissingAlt} of ${classic.totalImages} images missing alt attribute.`,
                    impact: "Medium",
                    recommendation: "Mark all <img/> with alt attributes for Image search ranking and machine learning.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/google-images"
                }
            },
            aiSeo: {
                atomicAnswers: {
                    passed: ai.hasTldr,
                    message: ai.hasTldr ? 'Direct answers (TL;DR) found.' : 'Missing Atomic Answers.',
                    impact: "High",
                    recommendation: "Add clear 'TL;DR' / 'Summary' headings with direct answer for the SGE model.",
                    sourceUrl: "https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142"
                },
                informationGain: {
                    passed: ai.hasPersonalExperience,
                    message: ai.hasPersonalExperience ? 'Original research (1st hand) confirmed.' : 'Missing Information Gain (encyclopedia fluff posted).',
                    impact: "High",
                    recommendation: "Google's Discovery prioritizes real experience. Include phrases like 'we tested' or 'our experience'.",
                    sourceUrl: "https://developers.google.com/search/blog/2026/02/discover-core-update"
                },
                llmAccessibility: {
                    passed: hasLlmsTxt,
                    message: hasLlmsTxt ? 'llms.txt exists in root.' : 'llms.txt missing in origin.',
                    impact: "Low",
                    recommendation: "Do as with robots.txt; put an llms.txt in the root to instruct new AI crawlers (Perplexity/ChatGPT).",
                    sourceUrl: "https://moz.com/blog/2026-seo-trends-predictions-from-20-experts"
                },
                technicalRendering: {
                    passed: ai.domNodesCount <= 1500,
                    domNodes: ai.domNodesCount,
                    scripts: ai.scriptsCount,
                    message: ai.domNodesCount <= 1500 ? `Page weight (DOM) OK.` : `Page is too script-heavy/deep (${ai.domNodesCount} nodes).`,
                    impact: "Medium",
                    recommendation: `Slim down DOM nodes to <1500. Speeds up AI Instant Rendering significantly.`,
                    sourceUrl: "https://developers.google.com/search/docs/appearance/core-web-vitals"
                }
            }
        }
    };
}
