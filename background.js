// Known tracking domains and patterns
const TRACKER_DOMAINS = [
  'google-analytics.com',
  'googlesyndication.com',
  'doubleclick.net',
  'facebook.com',
  'fbcdn.net',
  'scorecardresearch.com',
  'twitter.com',
  'adsystem.com',
  'adnxs.com',
  'amazon-adsystem.com'
];

const TRACKER_PATTERNS = [
  /_ga/,
  /_gid/,
  /_gat/,
  /fbp/,
  /fbc/,
  /tr/,
  /_fbp/,
  /_pin/,
  /track/,
  /uid/,
  /session/,
  /user_id/
];

class CookieMonitor {
  constructor() {
    this.cookieData = new Map();
    this.sandboxedSites = new Set();
    this.init();
  }

  async init() {
    // Load user preferences
    await this.loadPreferences();
    
    // Start monitoring
    this.startMonitoring();
    
    // Set up tab tracking
    this.setupTabTracking();
  }

  async loadPreferences() {
    const result = await chrome.storage.local.get(['sandboxedSites', 'monitoringEnabled']);
    if (result.sandboxedSites) {
      this.sandboxedSites = new Set(result.sandboxedSites);
    }
    this.monitoringEnabled = result.monitoringEnabled !== false; // Default to true
  }

  startMonitoring() {
    // Listen for cookie changes
    chrome.cookies.onChanged.addListener((changeInfo) => {
      if (!this.monitoringEnabled) return;
      
      const cookie = changeInfo.cookie;
      if (changeInfo.removed) {
        this.removeCookie(cookie);
      } else {
        this.processCookie(cookie);
      }
    });

    // Scan existing cookies on startup
    this.scanExistingCookies();
  }

  async scanExistingCookies() {
    try {
      const cookies = await chrome.cookies.getAll({});
      cookies.forEach(cookie => this.processCookie(cookie));
    } catch (error) {
      console.error('Error scanning existing cookies:', error);
    }
  }

  processCookie(cookie) {
    const riskScore = this.calculateRiskScore(cookie);
    const category = this.categorizeCookie(cookie);
    
    const cookieInfo = {
      ...cookie,
      riskScore,
      category,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      accessCount: 1
    };

    const key = this.getCookieKey(cookie);
    const existing = this.cookieData.get(key);
    
    if (existing) {
      cookieInfo.firstSeen = existing.firstSeen;
      cookieInfo.accessCount = existing.accessCount + 1;
    }

    this.cookieData.set(key, cookieInfo);
    this.updateStorage();
  }

  calculateRiskScore(cookie) {
    let score = 0;
    
    // Remove first-party check for now because we don't have tab context

    // Long expiration increases risk
    if (cookie.expirationDate) {
      const daysToExpire = (cookie.expirationDate * 1000 - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysToExpire > 365) score += 25;
      else if (daysToExpire > 30) score += 15;
    }
    
    // Large size increases risk
    if (cookie.value && cookie.value.length > 1000) {
      score += 10;
    }
    
    // Known tracker patterns
    if (this.isKnownTracker(cookie)) {
      score += 35;
    }
    
    // Security flags reduce risk
    if (cookie.secure) score -= 5;
    if (cookie.httpOnly) score -= 5;
    
    return Math.max(0, Math.min(100, score));
  }

  isKnownTracker(cookie) {
    const domain = cookie.domain.toLowerCase();
    return TRACKER_DOMAINS.some(tracker => domain.includes(tracker)) ||
           TRACKER_PATTERNS.some(pattern => pattern.test(cookie.name));
  }

  categorizeCookie(cookie) {
    if (this.isKnownTracker(cookie)) return 'tracker';
    // Remove third-party category for now because we don't have tab context
    if (cookie.session) return 'session';
    return 'functional';
  }

  getCookieKey(cookie) {
    return `${cookie.name}|${cookie.domain}|${cookie.path}`;
  }

  removeCookie(cookie) {
    const key = this.getCookieKey(cookie);
    this.cookieData.delete(key);
    this.updateStorage();
  }

  async updateStorage() {
    const data = Array.from(this.cookieData.values());
    await chrome.storage.local.set({ cookieData: data });
  }

  setupTabTracking() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.checkSandboxedSite(tab);
      }
    });
  }

  async checkSandboxedSite(tab) {
    if (!tab.url) return;
    
    try {
      const url = new URL(tab.url);
      const domain = url.hostname;
      
      if (this.sandboxedSites.has(domain)) {
        // Isolate cookies for sandboxed site
        await this.isolateSiteCookies(domain);
      }
    } catch (error) {
      console.error('Error checking sandboxed site:', error);
    }
  }

  isFirstPartyForDomain(cookie, domain) {
    // Remove leading dot if present
    const cookieDomain = cookie.domain.replace(/^\./, '');
    const siteDomain = domain.replace(/^\./, '');

    // The cookie is first-party if the site domain matches the cookie domain or is a subdomain of it
    return siteDomain === cookieDomain || siteDomain.endsWith('.' + cookieDomain);
  }

  async isolateSiteCookies(domain) {
    // Remove third-party cookies when visiting sandboxed sites
    const cookies = await chrome.cookies.getAll({ domain: domain });
    
    for (const cookie of cookies) {
      if (!this.isFirstPartyForDomain(cookie, domain)) {
        await chrome.cookies.remove({
          url: `https://${cookie.domain}${cookie.path}`,
          name: cookie.name
        });
      }
    }
  }

  // Public API methods
  async clearCookiesByCategory(category) {
    const cookies = Array.from(this.cookieData.values());
    
    for (const cookie of cookies) {
      if (cookie.category === category) {
        await chrome.cookies.remove({
          url: `https://${cookie.domain}${cookie.path}`,
          name: cookie.name
        });
      }
    }
  }

  async clearTrackerCookies() {
    await this.clearCookiesByCategory('tracker');
  }

  async addToSandbox(domain) {
    this.sandboxedSites.add(domain);
    await this.savePreferences();
  }

  async removeFromSandbox(domain) {
    this.sandboxedSites.delete(domain);
    await this.savePreferences();
  }

  async savePreferences() {
    await chrome.storage.local.set({
      sandboxedSites: Array.from(this.sandboxedSites),
      monitoringEnabled: this.monitoringEnabled
    });
  }

  getCookieSummary() {
    const cookies = Array.from(this.cookieData.values());
    const summary = {
      total: cookies.length,
      byCategory: {},
      byRisk: { low: 0, medium: 0, high: 0 },
      recentActivity: cookies.filter(c => Date.now() - c.lastSeen < 24 * 60 * 60 * 1000).length
    };

    cookies.forEach(cookie => {
      // Category count
      summary.byCategory[cookie.category] = (summary.byCategory[cookie.category] || 0) + 1;
      
      // Risk count
      if (cookie.riskScore < 33) summary.byRisk.low++;
      else if (cookie.riskScore < 66) summary.byRisk.medium++;
      else summary.byRisk.high++;
    });

    return summary;
  }
}

// Initialize the monitor
const monitor = new CookieMonitor();

// Message handling for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getCookieData':
      sendResponse({ 
        cookies: Array.from(monitor.cookieData.values()),
        summary: monitor.getCookieSummary(),
        sandboxedSites: Array.from(monitor.sandboxedSites)
      });
      break;
      
    case 'clearTrackerCookies':
      monitor.clearTrackerCookies().then(() => sendResponse({ success: true }));
      return true; // Will respond asynchronously
      
    case 'updateSandbox':
      if (request.add) {
        monitor.addToSandbox(request.domain);
      } else {
        monitor.removeFromSandbox(request.domain);
      }
      sendResponse({ success: true });
      break;
      
    case 'toggleMonitoring':
      monitor.monitoringEnabled = request.enabled;
      monitor.savePreferences();
      sendResponse({ success: true });
      break;
  }
});