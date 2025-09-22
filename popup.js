class CookiePrivacyPopup {
    constructor() {
        this.currentTab = 'dashboard';
        this.cookieData = [];
        this.sandboxedSites = [];
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.updateUI();
        
        // Refresh data every 5 seconds
        setInterval(() => this.loadData(), 5000);
    }

    async loadData() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getCookieData' });
            this.cookieData = response.cookies || [];
            this.sandboxedSites = response.sandboxedSites || [];
            this.updateUI();
        } catch (error) {
            console.error('Error loading cookie data:', error);
        }
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                e.target.classList.add('active');
                document.getElementById(`${e.target.dataset.tab}-tab`).classList.add('active');
                this.currentTab = e.target.dataset.tab;
            });
        });

        // Monitoring toggle
        document.getElementById('monitoringToggle').addEventListener('change', (e) => {
            chrome.runtime.sendMessage({ 
                action: 'toggleMonitoring', 
                enabled: e.target.checked 
            });
        });

        // Clear trackers button
        document.getElementById('clearTrackers').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all tracker cookies?')) {
                chrome.runtime.sendMessage({ action: 'clearTrackerCookies' });
                setTimeout(() => this.loadData(), 1000);
            }
        });

        // Clear all button
        document.getElementById('clearAll').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all cookies?')) {
                chrome.browsingData.removeCookies({}, () => {
                    setTimeout(() => this.loadData(), 1000);
                });
            }
        });

        // Add site to sandbox
        document.getElementById('addSite').addEventListener('click', () => {
            this.addSiteToSandbox();
        });

        document.getElementById('newSite').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addSiteToSandbox();
            }
        });
    }

    addSiteToSandbox() {
        const input = document.getElementById('newSite');
        const domain = input.value.trim().toLowerCase();
        
        if (!domain) return;
        
        // Basic domain validation
        if (!this.isValidDomain(domain)) {
            alert('Please enter a valid domain (e.g., example.com)');
            return;
        }
        
        if (this.sandboxedSites.includes(domain)) {
            alert('This domain is already in the sandbox');
            return;
        }
        
        chrome.runtime.sendMessage({ 
            action: 'updateSandbox', 
            add: true, 
            domain: domain 
        });
        
        input.value = '';
        setTimeout(() => this.loadData(), 500);
    }

    isValidDomain(domain) {
        // Simple domain validation
        return /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain);
    }

    removeSiteFromSandbox(domain) {
        chrome.runtime.sendMessage({ 
            action: 'updateSandbox', 
            add: false, 
            domain: domain 
        });
        setTimeout(() => this.loadData(), 500);
    }

    updateUI() {
        this.updateSummary();
        this.updateRecentCookies();
        this.updateSandboxList();
    }

    updateSummary() {
        const summary = this.getCookieSummary();
        
        document.getElementById('totalCookies').textContent = summary.total;
        document.getElementById('trackerCookies').textContent = summary.byCategory.tracker || 0;
        document.getElementById('highRiskCookies').textContent = summary.byRisk.high;
        document.getElementById('recentActivity').textContent = summary.recentActivity;
    }

    getCookieSummary() {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        
        const summary = {
            total: this.cookieData.length,
            byCategory: {},
            byRisk: { low: 0, medium: 0, high: 0 },
            recentActivity: this.cookieData.filter(c => c.lastSeen > oneDayAgo).length
        };

        this.cookieData.forEach(cookie => {
            // Category count
            summary.byCategory[cookie.category] = (summary.byCategory[cookie.category] || 0) + 1;
            
            // Risk count
            if (cookie.riskScore < 33) summary.byRisk.low++;
            else if (cookie.riskScore < 66) summary.byRisk.medium++;
            else summary.byRisk.high++;
        });

        return summary;
    }

    updateRecentCookies() {
        const container = document.getElementById('recentCookies');
        const recentCookies = this.cookieData
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .slice(0, 10);

        if (recentCookies.length === 0) {
            container.innerHTML = '<div class="empty-state">No recent cookie activity</div>';
            return;
        }

        container.innerHTML = recentCookies.map(cookie => `
            <div class="cookie-item">
                <div class="cookie-info">
                    <div class="cookie-name">${this.escapeHtml(cookie.name)}</div>
                    <div class="cookie-domain">${this.escapeHtml(cookie.domain)}</div>
                </div>
                <div class="cookie-actions">
                    <span class="risk-indicator risk-${this.getRiskLevel(cookie.riskScore)}"></span>
                    <button class="delete-cookie" data-name="${cookie.name}" data-domain="${cookie.domain}">×</button>
                </div>
            </div>
        `).join('');

        // Add delete handlers
        container.querySelectorAll('.delete-cookie').forEach(button => {
            button.addEventListener('click', (e) => {
                const name = e.target.dataset.name;
                const domain = e.target.dataset.domain;
                this.deleteCookie(name, domain);
            });
        });
    }

    updateSandboxList() {
        const container = document.getElementById('sandboxSites');
        
        if (this.sandboxedSites.length === 0) {
            container.innerHTML = '<div class="empty-state">No sites in sandbox</div>';
            return;
        }

        container.innerHTML = this.sandboxedSites.map(site => `
            <div class="sandbox-item">
                <span>${this.escapeHtml(site)}</span>
                <button class="remove-site" data-domain="${site}">Remove</button>
            </div>
        `).join('');

        // Add remove handlers
        container.querySelectorAll('.remove-site').forEach(button => {
            button.addEventListener('click', (e) => {
                const domain = e.target.dataset.domain;
                this.removeSiteFromSandbox(domain);
            });
        });
    }

    getRiskLevel(score) {
        if (score < 33) return 'low';
        if (score < 66) return 'medium';
        return 'high';
    }

    async deleteCookie(name, domain) {
        try {
            await chrome.cookies.remove({
                url: `https://${domain}/`,
                name: name
            });
            this.loadData(); // Refresh data
        } catch (error) {
            console.error('Error deleting cookie:', error);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CookiePrivacyPopup();
});