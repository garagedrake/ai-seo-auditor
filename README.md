# SEO Domain Analyzer

Ett analysverktyg skrivet i Node.js för utvärdering av webbplatser utifrån teknisk prestanda (Core Web Vitals) och heuristiska markörer för LLM-läsbarhet (SGE/GEO). Verktyget utför en rekursiv genomsökning via Puppeteer och levererar en prioriterad åtgärdslista över SSE.

## Funktioner
* **Rekursiv genomsökning:** Utför Breadth-First Search (BFS) utifrån angivet djup för att analysera interna sidor.
* **Åtgärdsrapport:** Sammanställer tekniska brister och avvikelser i sidstruktur från samtliga genomsökta URL:er, sorterade efter prioritet.
* **Terminalvy:** Strömmar systemloggar direkt i gränssnittet under körning.
* **Heuristisk AI-analys:** Utvärderar förekomst av LLM-specifika strukturer (`llms.txt`), DOM-komplexitet samt textuella markörer för "Atomic Answers" och "Information Gain". *Observera att analysen av textinnehåll sker via nyckelordsheuristik och inte genom semantisk utvärdering via externt API.*
* **Historik:** Sparar tidigare körningar lokalt, grupperade per domän.

## Installation & Körning

Kräver Node.js.

```bash
git clone [https://github.com/your-username/ai-seo-auditor.git](https://github.com/your-username/ai-seo-auditor.git)
cd ai-seo-auditor
npm install
node server.js