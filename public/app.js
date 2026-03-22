const elements = {
    form: document.getElementById('analyzeForm'),
    input: document.getElementById('urlInput'),
    depth: document.getElementById('depthSelect'),
    btn: document.getElementById('analyzeBtn'),
    terminal: document.getElementById('terminalContainer'),
    terminalBody: document.getElementById('terminalBody'),
    result: document.getElementById('resultSection'),
    error: document.getElementById('errorContainer'),
    list: document.getElementById('reportsList'),
    status: document.getElementById('knowledgeStatus'),
    actionPlanContainer: document.getElementById('actionPlanContainer'),
    actionList: document.getElementById('actionList') // keeping for fallback/success message
};

let eventSource = null;

document.addEventListener('DOMContentLoaded', () => {
    fetchKnowledgeStatus();
    fetchReports();
});

async function fetchKnowledgeStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.isOutdated) {
            elements.status.className = 'knowledge-status warn';
            elements.status.textContent = `⚠️ Update required! Source rules are ${data.daysOld} days old.`;
        } else {
            elements.status.className = 'knowledge-status ok';
            elements.status.textContent = `✓ Knowledge base active (${data.daysOld} days)`;
        }
    } catch(e) { elements.status.textContent = 'Server unreachable'; }
}

async function fetchReports() {
    try {
        const res = await fetch('/api/reports');
        const reports = await res.json();
        elements.list.innerHTML = '';
        
        if(reports.length === 0) {
            elements.list.innerHTML = '<p style="color:#64748b; font-size:0.9rem; margin-top:10px;">No reports found.</p>';
            return;
        }

        const grouped = {};
        reports.forEach(r => {
            const dom = r.domain || 'Unknown domain';
            if(!grouped[dom]) grouped[dom] = [];
            grouped[dom].push(r);
        });

        for (const [domain, runs] of Object.entries(grouped)) {
            const groupWrap = document.createElement('div');
            groupWrap.className = 'domain-group';
            
            const header = document.createElement('div');
            header.className = 'domain-header';
            header.innerHTML = `
                <span>${domain.replace('https://', '').replace('http://', '')}</span>
                <span class="badge">${runs.length}</span>
            `;

            const runsWrap = document.createElement('div');
            runsWrap.className = 'domain-runs';
            
            runs.forEach(report => {
                const runDiv = document.createElement('div');
                runDiv.className = 'run-item';
                runDiv.innerHTML = `
                    <div class="date">${new Date(report.date).toLocaleString('sv-SE')}</div>
                    <div class="meta">${report.pagesAnalyzed} pages analyzed</div>
                `;
                runDiv.addEventListener('click', () => renderReport(report));
                runsWrap.appendChild(runDiv);
            });

            header.addEventListener('click', () => {
                runsWrap.classList.toggle('open');
            });

            groupWrap.appendChild(header);
            groupWrap.appendChild(runsWrap);
            elements.list.appendChild(groupWrap);
        }
    } catch(e) { console.error(e); }
}

document.addEventListener('click', async (e) => {
    if (e.target.id === 'clearHistoryBtn') {
        if(confirm('Are you sure you want to clear all history?')) {
            try {
                await fetch('/api/reports', { method: 'DELETE' });
                fetchReports();
                elements.result.classList.add('hidden');
            } catch(e) {}
        }
    }
});



elements.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = elements.input.value.trim();
    if(!url) return;

    elements.error.classList.add('hidden');
    elements.result.classList.add('hidden');
    elements.terminal.classList.remove('hidden');
    elements.terminalBody.innerHTML = '';
    elements.btn.disabled = true;

    if (eventSource) eventSource.close();

    eventSource = new EventSource(`/api/analyze-stream?url=${encodeURIComponent(url)}&depth=${elements.depth.value}`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.error) {
            eventSource.close();
            elements.btn.disabled = false;
            elements.terminal.classList.add('hidden');
            elements.error.classList.remove('hidden');
            elements.error.innerHTML = `<strong>Error:</strong> <br>${data.error}`;
            return;
        }

        if (data.type === 'progress') {
            const div = document.createElement('div');
            div.className = 'terminal-line blinking';
            div.textContent = data.message;
            
            const lines = elements.terminalBody.querySelectorAll('.terminal-line');
            lines.forEach(l => l.classList.remove('blinking'));

            elements.terminalBody.appendChild(div);
            elements.terminalBody.scrollTop = elements.terminalBody.scrollHeight;
        } 
        else if (data.type === 'result') {
            eventSource.close();
            elements.btn.disabled = false;
            elements.terminal.classList.add('hidden');
            renderReport(data.report);
            fetchReports(); 
        } 
        else if (data.type === 'error') {
            eventSource.close();
            elements.btn.disabled = false;
            elements.terminal.classList.add('hidden');
            elements.error.classList.remove('hidden');
            elements.error.innerHTML = `<strong>Analysis crashed:</strong> <br>${data.error}`;
        }
    };

    eventSource.onerror = (err) => {
        eventSource.close();
        elements.btn.disabled = false;
        elements.terminal.classList.add('hidden');
        elements.error.classList.remove('hidden');
        elements.error.innerHTML = `<strong>Network error:</strong> Could not connect to the server process.`;
    };
});

const titles = {
    title: "Title Tag",
    metaDescription: "Meta Description",
    h1: "H1 Structure",
    canonical: "Canonical Tag",
    imagesAlt: "Images Alt-attribute",
    atomicAnswers: "Atomic Answers (TL;DR)",
    informationGain: "Information Gain",
    llmAccessibility: "LLM Accessibility (llms.txt)",
    technicalRendering: "DOM Bloat & Rendering"
};

function renderReport(report) {
    document.getElementById('resUrl').textContent = `${report.domain} [${report.pagesAnalyzed} pages]`;
    document.getElementById('resDate').textContent = new Date(report.date).toLocaleString('sv-SE');

    const prios = { High: { classic: [], ai: [] }, Medium: { classic: [], ai: [] }, Low: { classic: [], ai: [] } };
    
    report.pages.forEach(page => {
        const classic = page.categories.classicSeo;
        for(const key in classic) {
            if(classic[key] && !classic[key].passed) {
                const impact = classic[key].impact || 'Medium';
                prios[impact].classic.push({ pageUrl: page.url, title: titles[key], ...classic[key] });
            }
        }

        const ai = page.categories.aiSeo;
        for(const key in ai) {
            if(ai[key] && !ai[key].passed) {
                const impact = ai[key].impact || 'Medium';
                prios[impact].ai.push({ pageUrl: page.url, title: titles[key], ...ai[key] });
            }
        }
    });

    const hasErrors = Object.values(prios).some(p => p.classic.length > 0 || p.ai.length > 0);
    elements.actionPlanContainer.classList.remove('hidden');

    if (hasErrors) {
        elements.actionList.style.display = 'none'; // hiding fallback
        renderAccordion('prioHighContainer', 'CRITICAL PRIORITY', prios.High);
        renderAccordion('prioMediumContainer', 'MEDIUM PRIORITY', prios.Medium);
        renderAccordion('prioLowContainer', 'LOW PRIORITY', prios.Low);
        
        // Automatically expand High Prio
        const highAccordion = document.getElementById('prioHighContainer');
        if(highAccordion.style.display === 'block') highAccordion.classList.add('open');
    } else {
        ['prioHighContainer', 'prioMediumContainer', 'prioLowContainer'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
        elements.actionList.style.display = 'block';
        elements.actionList.innerHTML = `
            <li class="action-item" style="border-left: 4px solid var(--success); background: rgba(16,185,129,0.05);">
                <div class="action-item-header">
                    <span class="action-item-title" style="color:var(--success);">Nothing to fix!</span>
                </div>
                <p>All analyzed pages passed completely.</p>
            </li>
        `;
    }

    elements.error.classList.add('hidden');
    elements.result.classList.remove('hidden');
    
    setTimeout(() => { elements.result.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
}

function renderAccordion(containerId, title, dataGroup) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    // Reset open state
    container.classList.remove('open');
    
    if (dataGroup.classic.length === 0 && dataGroup.ai.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';

    const header = document.createElement('div');
    header.className = 'prio-accordion-header';
    header.innerHTML = `<span>${title} (${dataGroup.classic.length + dataGroup.ai.length} warnings)</span> <span>↕</span>`;
    header.addEventListener('click', () => container.classList.toggle('open'));

    const body = document.createElement('div');
    body.className = 'prio-accordion-body';

    if (dataGroup.classic.length > 0) {
        const wrap = document.createElement('div');
        wrap.className = 'category-wrapper';
        wrap.innerHTML = `<h4>📌 Classic SEO</h4><ul class="action-list"></ul>`;
        const ul = wrap.querySelector('ul');
        dataGroup.classic.forEach(item => ul.appendChild(createActionItemUI(item)));
        body.appendChild(wrap);
    }

    if (dataGroup.ai.length > 0) {
        const wrap = document.createElement('div');
        wrap.className = 'category-wrapper';
        wrap.innerHTML = `<h4>🤖 GEO & AI Overviews (2026)</h4><ul class="action-list"></ul>`;
        const ul = wrap.querySelector('ul');
        dataGroup.ai.forEach(item => ul.appendChild(createActionItemUI(item)));
        body.appendChild(wrap);
    }

    container.appendChild(header);
    container.appendChild(body);
}

function createActionItemUI(data) {
    const li = document.createElement('li');
    li.className = `action-item`;
    
    let pathLabel = data.pageUrl;
    try { pathLabel = new URL(data.pageUrl).pathname || '/'; } catch(e){}

    li.innerHTML = `
        <div class="action-item-header">
            <div>
                <span class="action-item-url">📍 ${pathLabel}</span>
                <span class="action-item-title">${data.title} - ${data.message}</span>
            </div>
        </div>
        <p class="action-item-recomendation"><strong>⚙️ Fix:</strong> ${data.recommendation}</p>
        <a href="${data.sourceUrl}" target="_blank" class="action-item-source">🔗 Read more in official documentation</a>
    `;
    return li;
}
