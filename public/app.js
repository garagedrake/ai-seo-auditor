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
    actionList: document.getElementById('actionList'), // keeping for fallback/success message
    exportBtn: document.getElementById('exportPdfBtn'),
    pdfError: document.getElementById('pdfErrorMsg')
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

elements.exportBtn?.addEventListener('click', () => {
    const btn = elements.exportBtn;
    const originalText = btn.textContent;
    btn.textContent = '⏳ Generating...';
    btn.disabled = true;

    const report = window.currentReport;
    if (!report) return;

    const exportContainer = document.createElement('div');
    let html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto;">
        <h1 style="color: #111827; font-size: 28px; border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">SEO & GEO Master Report</h1>
        <div style="margin-bottom: 32px; font-size: 14px; color: #4b5563;">
            <p style="margin: 4px 0;"><strong>Domain:</strong> ${report.domain}</p>
            <p style="margin: 4px 0;"><strong>Pages Analyzed:</strong> ${report.pagesAnalyzed}</p>
            <p style="margin: 4px 0;"><strong>Date:</strong> ${new Date(report.date).toLocaleString('en-US')}</p>
        </div>
    `;

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

    Object.entries(prios).forEach(([prioLevel, groups]) => {
        if (groups.classic.length === 0 && groups.ai.length === 0) return;
        
        const colors = { High: '#dc2626', Medium: '#d97706', Low: '#2563eb' };
        html += `<h2 style="color: ${colors[prioLevel]}; font-size: 20px; border-bottom: 2px solid ${colors[prioLevel]}40; padding-bottom: 8px; margin-top: 40px; margin-bottom: 20px;">${prioLevel.toUpperCase()} PRIORITY</h2>`;
        
        ['classic', 'ai'].forEach(type => {
            if (groups[type].length > 0) {
                html += `<h3 style="color: #374151; font-size: 16px; margin-top: 24px; margin-bottom: 16px;">${type === 'classic' ? '📌 Classic SEO' : '🤖 GEO & AI Overviews (2026)'}</h3>`;
                groups[type].forEach(item => {
                    let pathLabel = item.pageUrl;
                    try { pathLabel = new URL(item.pageUrl).pathname || '/'; } catch(e){}
                    html += `
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; margin-bottom: 16px; border-radius: 8px; page-break-inside: avoid;">
                        <div style="font-size: 13px; color: #6b7280; font-family: monospace; margin-bottom: 8px;">📍 ${pathLabel}</div>
                        <div style="font-weight: 600; font-size: 16px; color: #111827; margin-bottom: 12px; line-height: 1.4;">${item.title} - ${item.message}</div>
                        <div style="color: #374151; font-size: 14px; line-height: 1.5; margin-bottom: 12px;"><strong>⚙️ Fix:</strong> ${item.recommendation}</div>
                        <a href="${item.sourceUrl}" style="color: #2563eb; font-size: 13px; text-decoration: none;">🔗 Read more in official documentation</a>
                    </div>`;
                });
            }
        });
    });

    html += `</div>`;
    exportContainer.innerHTML = html;

    const opt = {
        margin:       0.2,
        filename:     `SEO_Report_${report.domain.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
        image:        { type: 'jpeg', quality: 1.0 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'in', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    html2pdf().set(opt).from(exportContainer).toPdf().get('pdf').then((pdf) => {
        window.open(pdf.output('bloburl'), '_blank');
    }).finally(() => {
        btn.textContent = originalText;
        btn.disabled = false;
    });
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
    window.currentReport = report;
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

    if (report.pagesAnalyzed > 15) {
        elements.exportBtn.style.display = 'none';
        elements.pdfError.classList.remove('hidden');
    } else {
        elements.exportBtn.style.display = 'inline-block';
        elements.pdfError.classList.add('hidden');
        elements.exportBtn.dataset.domain = report.domain;
    }

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
