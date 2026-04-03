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

    // Cache the llms.txt check – it only needs to be fetched once per domain
    let hasLlmsTxt = null;

    try {
        onProgress(`Launching Headless Crawler... (Goal: Depth ${maxDepth}, Max ${MAX_PAGES} pages)`);
        browser = await puppeteer.launch({ headless: true });
        const startOrigin = new URL(startUrl).origin;

        while (queue.length > 0 && visited.size < MAX_PAGES) {
            // Check for user-initiated cancellation at the start of each iteration
            if (signal && signal.aborted) {
                onProgress('Crawl aborted by user. Cleaning up...');
                break;
            }

            const current = queue.shift();

            // Strip URL fragments (#section) to avoid re-analysing the same page
            let crawlUrl = current.url;
            try {
                const u = new URL(crawlUrl);
                u.hash = '';
                crawlUrl = u.href;
            } catch (e) { continue; }

            // Skip already-visited pages
            if (visited.has(crawlUrl)) continue;
            visited.add(crawlUrl);

            onProgress(`[Depth ${current.depth}] Analyzing: ${crawlUrl.substring(startOrigin.length) || '/'}`);

            const page = await browser.newPage();
            // setDefaultNavigationTimeout is synchronous (void), no await needed
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

                // Collect internal links for breadth-first crawling
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

            // 2. AI SEO / SGE signals
            const aiSeo = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                const hasTldr = text.includes('tl;dr') || text.includes('summary') || text.includes('sammanfattning');
                const hasPersonalExperience = text.includes('testade') || text.includes('vår forskning') || text.includes('our research') || text.includes('i tested');
                const domNodesCount = document.querySelectorAll('*').length;
                const scriptsCount = document.querySelectorAll('script').length;
                return { hasTldr, hasPersonalExperience, domNodesCount, scriptsCount };
            });

            // 3. llms.txt check – cached after first successful fetch (domain-level, not per-page)
            if (hasLlmsTxt === null) {
                try {
                    const llmsRes = await fetch(`${startOrigin}/llms.txt`);
                    hasLlmsTxt = llmsRes.ok;
                } catch (e) {
                    hasLlmsTxt = false;
                }
            }

            await page.close();

            // Enqueue child links if we haven't reached max depth
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
                    message: classic.title ? `Title: ${classic.title} (${classic.title.length} tecken).` : 'Kritisk brist: Sidan saknar <title> eller är för kort.',
                    impact: "High",
                    recommendation: "Skriv en unik och beskrivande <title>-tagg på 50-60 tecken.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/title-link"
                },
                metaDescription: {
                    passed: classic.metaDesc && classic.metaDesc.length >= 70 && classic.metaDesc.length <= 160,
                    message: classic.metaDesc ? `Meta Description OK (${classic.metaDesc.length} tecken).` : 'Meta Description saknas eller avviker från optimal längd.',
                    impact: "Low",
                    recommendation: "Skriv en <meta name='description'>-tagg på max 160 tecken för att öka CTR i sökresultatet.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/snippet"
                },
                h1: {
                    passed: classic.h1Count === 1,
                    message: classic.h1Count === 1 ? 'Exakt en H1-rubrik hittades.' : `Felaktig hierarki. Sidan har ${classic.h1Count} st H1-rubriker.`,
                    impact: "High",
                    recommendation: "Säkerställ att undersidan har exakt EN (1) <H1>-rubrik.",
                    sourceUrl: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide#heading-tags"
                },
                canonical: {
                    passed: !!classic.canonical,
                    message: classic.canonical ? 'Canonical-länk implementerad.' : 'Canonical-länk saknas.',
                    impact: "High",
                    recommendation: "Implementera <link rel='canonical' href='...'> i sidans <head> för att undvika duplicerat innehåll.",
                    sourceUrl: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"
                },
                imagesAlt: {
                    passed: classic.imagesMissingAlt === 0,
                    message: classic.imagesMissingAlt === 0 ? 'Alla bilder har alt-attribut.' : `${classic.imagesMissingAlt} av ${classic.totalImages} bilder saknar alt-attribut.`,
                    impact: "Medium",
                    recommendation: "Förse alla <img/>-taggar med alt-attribut för tillgänglighet och bildsök.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/google-images"
                }
            },
            aiSeo: {
                atomicAnswers: {
                    passed: ai.hasTldr,
                    message: ai.hasTldr ? 'Möjlig koncis summering hittad.' : 'Saknar tydlig struktur för Atomic Answers.',
                    impact: "High",
                    recommendation: "Ingen koncis summering (ex. TL;DR) identifierades i dokumentets struktur. SGE-modeller prioriterar innehåll där direkta svar enkelt kan extraheras. (Obs: Bedömningen bygger på textheuristik, kräver manuell granskning).",
                    sourceUrl: "https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142"
                },
                informationGain: {
                    passed: ai.hasPersonalExperience,
                    message: ai.hasPersonalExperience ? 'Markörer för Information Gain funna.' : 'Låg sannolikhet för Information Gain.',
                    impact: "High",
                    recommendation: "Inga lexikala markörer för förstahandserfarenhet eller unik data identifierades. Texten bör demonstrera faktisk expertis och inte enbart summera befintlig fakta. (Obs: Bedömningen bygger på textheuristik, kräver manuell granskning).",
                    sourceUrl: "https://developers.google.com/search/blog/2026/02/discover-core-update"
                },
                llmAccessibility: {
                    passed: hasLlmsTxt,
                    message: hasLlmsTxt ? 'llms.txt existerar i roten.' : 'llms.txt saknas.',
                    impact: "Low",
                    recommendation: "Placera en llms.txt i domänens rotkatalog för att ge instruktioner till AI-crawlers (ex. Perplexity/OpenAI).",
                    sourceUrl: "https://moz.com/blog/2026-seo-trends-predictions-from-20-experts"
                },
                technicalRendering: {
                    passed: ai.domNodesCount <= 1500,
                    domNodes: ai.domNodesCount,
                    scripts: ai.scriptsCount,
                    message: ai.domNodesCount <= 1500 ? `DOM-storlek OK (${ai.domNodesCount} noder).` : `DOM överstiger rekommenderad gräns (${ai.domNodesCount} noder).`,
                    impact: "Medium",
                    recommendation: "Reducera antalet DOM-noder till under 1500. En lättviktig struktur påskyndar AI-modellers rendering och extrahering av innehåll.",
                    sourceUrl: "https://developers.google.com/search/docs/appearance/core-web-vitals"
                }
            }
        }
    };
}