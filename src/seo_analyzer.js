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
    const dateMatch = content.match(/Last updated:\s*(\d{4}-\d{2}-\d{2})/i);
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

/**
 * Crawls startUrl up to maxDepth levels deep and returns a structured SEO report.
 * @param {string} startUrl - The URL to start crawling from.
 * @param {number} maxDepth - Maximum BFS depth (0 = single page only).
 * @param {function} onProgress - Callback for real-time progress messages.
 * @param {AbortSignal|null} signal - Optional signal to cancel the crawl.
 */
export async function analyzeUrl(startUrl, maxDepth = 0, onProgress = () => {}, signal = null) {
    let browser;
    const visited = new Set();
    const queue = [{ url: startUrl, depth: 0 }];
    const pagesResults = [];
    const MAX_PAGES = 100;

    let hasLlmsTxt = null;

    try {
        onProgress(`Launching Headless Crawler... (Goal: Depth ${maxDepth}, Max ${MAX_PAGES} pages)`);
        browser = await puppeteer.launch({ headless: true });
        const startOrigin = new URL(startUrl).origin;

        while (queue.length > 0 && visited.size < MAX_PAGES) {
            if (signal && signal.aborted) {
                onProgress('Crawl aborted by user. Cleaning up...');
                break;
            }

            const current = queue.shift();

            let crawlUrl = current.url;
            try {
                const u = new URL(crawlUrl);
                u.hash = '';
                crawlUrl = u.href;
            } catch (e) { continue; }

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

            const aiSeo = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                const hasTldr = text.includes('tl;dr') || text.includes('summary') || text.includes('key takeaways');
                const hasPersonalExperience = text.includes('we tested') || text.includes('our research') || text.includes('i tested') || text.includes('our experience');
                const domNodesCount = document.querySelectorAll('*').length;
                const scriptsCount = document.querySelectorAll('script').length;
                return { hasTldr, hasPersonalExperience, domNodesCount, scriptsCount };
            });

            if (hasLlmsTxt === null) {
                try {
                    const llmsRes = await fetch(`${startOrigin}/llms.txt`);
                    hasLlmsTxt = llmsRes.ok;
                } catch (e) {
                    hasLlmsTxt = false;
                }
            }

            await page.close();

            if (current.depth < maxDepth) {
                const uniqueLinks = [...new Set(classicSeo.internalLinks)];
                for (const link of uniqueLinks) {
                    if (!visited.has(link)) {
                        queue.push({ url: link, depth: current.depth + 1 });
                    }
                }
            }

            pagesResults.push(generatePageData(crawlUrl, classicSeo, aiSeo, hasLlmsTxt ?? false));
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
        throw new Error(error.message);
    }
}

function generatePageData(url, classic, ai, hasLlmsTxt) {
    return {
        url: url,
        categories: {
            classicSeo: {
                title: {
                    passed: classic.title && classic.title.length >= 30 && classic.title.length <= 65,
                    message: classic.title ? `Title: ${classic.title} (${classic.title.length} characters).` : 'Critical flaw: Page lacks <title> or is too short.',
                    impact: "High",
                    recommendation: "Write a unique and descriptive <title> tag of 50-60 characters.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/title-link"
                },
                metaDescription: {
                    passed: classic.metaDesc && classic.metaDesc.length >= 70 && classic.metaDesc.length <= 160,
                    message: classic.metaDesc ? `Meta Description OK (${classic.metaDesc.length} characters).` : 'Meta Description missing or deviates from optimal length.',
                    impact: "Low",
                    recommendation: "Write a <meta name='description'> tag of max 160 characters to increase CTR in search results.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/snippet"
                },
                h1: {
                    passed: classic.h1Count === 1,
                    message: classic.h1Count === 1 ? 'Exactly one H1 heading found.' : `Incorrect hierarchy. Page has ${classic.h1Count} H1 headings.`,
                    impact: "High",
                    recommendation: "Ensure the subpage has exactly ONE (1) <H1> heading.",
                    sourceUrl: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide#heading-tags"
                },
                canonical: {
                    passed: !!classic.canonical,
                    message: classic.canonical ? 'Canonical link implemented.' : 'Canonical link missing.',
                    impact: "High",
                    recommendation: "Implement <link rel='canonical' href='...'> in the page's <head> to avoid duplicate content.",
                    sourceUrl: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"
                },
                imagesAlt: {
                    passed: classic.imagesMissingAlt === 0,
                    message: classic.imagesMissingAlt === 0 ? 'All images have alt attributes.' : `${classic.imagesMissingAlt} of ${classic.totalImages} images missing alt attributes.`,
                    impact: "Medium",
                    recommendation: "Provide all <img/> tags with alt attributes for accessibility and image search.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/google-images"
                }
            },
            aiSeo: {
                atomicAnswers: {
                    passed: ai.hasTldr,
                    message: ai.hasTldr ? 'Possible concise summary found.' : 'Lacks clear structure for Atomic Answers.',
                    impact: "High",
                    recommendation: "No concise summary (e.g., TL;DR) was identified in the upper structure of the document. SGE models prioritize content where direct answers can be easily extracted. (Note: Assessment is based on text heuristics, requires manual review).",
                    sourceUrl: "https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142"
                },
                informationGain: {
                    passed: ai.hasPersonalExperience,
                    message: ai.hasPersonalExperience ? 'Markers for Information Gain found.' : 'Low probability of Information Gain.',
                    impact: "High",
                    recommendation: "No lexical markers for first-hand experience or unique data were identified. The text should demonstrate actual expertise and not merely summarize existing facts. (Note: Assessment is based on text heuristics, requires manual review).",
                    sourceUrl: "https://developers.google.com/search/blog/2026/02/discover-core-update"
                },
                llmAccessibility: {
                    passed: hasLlmsTxt,
                    message: hasLlmsTxt ? 'llms.txt exists in root.' : 'llms.txt missing.',
                    impact: "Low",
                    recommendation: "Place an llms.txt in the domain's root directory to provide instructions to AI crawlers (e.g., Perplexity/OpenAI).",
                    sourceUrl: "https://moz.com/blog/2026-seo-trends-predictions-from-20-experts"
                },
                technicalRendering: {
                    passed: ai.domNodesCount <= 1500,
                    domNodes: ai.domNodesCount,
                    scripts: ai.scriptsCount,
                    message: ai.domNodesCount <= 1500 ? `DOM size OK (${ai.domNodesCount} nodes).` : `DOM exceeds recommended limit (${ai.domNodesCount} nodes).`,
                    impact: "Medium",
                    recommendation: "Reduce the number of DOM nodes to below 1500. A lightweight structure accelerates AI models' rendering and extraction of content.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/core-web-vitals"
                }
            }
        }
    };
}