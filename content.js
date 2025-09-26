// Content script for Minerva Forum Assistant
class MinervaContentScript {
  constructor() {
    this.sidebar = null;
    this.apiData = [];
    this.pollData = new Map();
    this.setupInterception();
    this.createSidebar();
    this.setupMessageListener();
  }

  setupInterception() {
    // Intercept fetch requests
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      
      // Check if this is a relevant API call
      const url = args[0];
      if (typeof url === 'string' && url.includes('/api/')) {
        this.handleInterceptedResponse(url, response.clone());
      }
      
      return response;
    };

    // Intercept XMLHttpRequest
    const originalXHR = window.XMLHttpRequest;
    const self = this;
    
    window.XMLHttpRequest = function() {
      const xhr = new originalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      
      xhr.open = function(method, url, ...args) {
        this._method = method;
        this._url = url;
        return originalOpen.apply(this, [method, url, ...args]);
      };
      
      xhr.send = function(data) {
        this.addEventListener('load', function() {
          if (this._url && this._url.includes('/api/')) {
            self.handleInterceptedXHR(this._url, this.responseText, this._method);
          }
        });
        return originalSend.apply(this, [data]);
      };
      
      return xhr;
    };
  }

  async handleInterceptedResponse(url, response) {
    try {
      const data = await response.json();
      this.processApiData(url, data);
    } catch (error) {
      console.log('Failed to parse response:', error);
    }
  }

  handleInterceptedXHR(url, responseText, method) {
    try {
      const data = JSON.parse(responseText);
      this.processApiData(url, data, method);
    } catch (error) {
      console.log('Failed to parse XHR response:', error);
    }
  }

  processApiData(url, data, method = 'GET') {
    // Store API data for analysis
    const apiEntry = {
      url,
      data,
      method,
      timestamp: Date.now()
    };
    
    this.apiData.push(apiEntry);
    
    // Check if this contains poll data
    if (this.isPollData(url, data)) {
      this.processPollData(data);
    }
    
    // Update sidebar with new data
    this.updateSidebar();
  }

  isPollData(url, data) {
    // Check if the URL or data structure indicates poll responses
    return url.includes('poll') || 
           url.includes('response') || 
           (data && (data.responses || data.answers || data.submissions));
  }

  processPollData(data) {
    // Extract and structure poll response data
    let responses = [];
    
    if (data.responses) {
      responses = data.responses;
    } else if (data.answers) {
      responses = data.answers;
    } else if (data.submissions) {
      responses = data.submissions;
    } else if (Array.isArray(data)) {
      responses = data;
    }
    
    responses.forEach(response => {
      if (response.student_id || response.user_id) {
        const studentId = response.student_id || response.user_id;
        this.pollData.set(studentId, {
          ...response,
          timestamp: Date.now()
        });
      }
    });
  }

  createSidebar() {
    // Create sidebar container
    this.sidebar = document.createElement('div');
    this.sidebar.id = 'minerva-assistant-sidebar';
    this.sidebar.className = 'minerva-sidebar';
    
    // Create sidebar content
    this.sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Minerva Assistant</h3>
        <button id="toggle-sidebar" class="toggle-btn">−</button>
      </div>
      <div class="sidebar-content">
        <div class="section">
          <h4>Settings</h4>
          <button id="open-settings" class="btn">Configure API Key</button>
        </div>
        
        <div class="section">
          <h4>Rubric</h4>
          <textarea id="rubric-input" placeholder="Enter your rubric here or paste Google Sheets link..."></textarea>
          <button id="save-rubric" class="btn">Save Rubric</button>
        </div>
        
        <div class="section">
          <h4>Student Responses</h4>
          <div id="responses-list">
            <p>No responses detected yet...</p>
          </div>
        </div>
        
        <div class="section">
          <h4>AI Analysis</h4>
          <button id="analyze-responses" class="btn btn-primary">Analyze All Responses</button>
          <div id="analysis-results"></div>
        </div>
        
        <div class="section">
          <h4>Engagement Metrics</h4>
          <div id="engagement-metrics">
            <p>Loading metrics...</p>
          </div>
        </div>
      </div>
    `;
    
    // Add sidebar to page
    document.body.appendChild(this.sidebar);
    
    // Setup event listeners
    this.setupSidebarEvents();
  }

  setupSidebarEvents() {
    // Toggle sidebar
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
      this.sidebar.classList.toggle('collapsed');
    });
    
    // Open settings
    document.getElementById('open-settings').addEventListener('click', () => {
      this.openSettingsModal();
    });
    
    // Save rubric
    document.getElementById('save-rubric').addEventListener('click', () => {
      this.saveRubric();
    });
    
    // Analyze responses
    document.getElementById('analyze-responses').addEventListener('click', () => {
      this.analyzeAllResponses();
    });
  }

  openSettingsModal() {
    // Create settings modal
    const modal = document.createElement('div');
    modal.className = 'minerva-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Settings</h3>
          <button class="close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <label for="openai-key">OpenAI API Key:</label>
          <input type="password" id="openai-key" placeholder="Enter your OpenAI API key">
          <p class="help-text">Your API key is stored locally and never shared.</p>
        </div>
        <div class="modal-footer">
          <button id="save-settings" class="btn btn-primary">Save</button>
          <button class="close-modal btn">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Load existing settings
    this.loadSettings().then(settings => {
      if (settings.openaiApiKey) {
        document.getElementById('openai-key').value = settings.openaiApiKey;
      }
    });
    
    // Setup modal events
    modal.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => modal.remove());
    });
    
    document.getElementById('save-settings').addEventListener('click', async () => {
      const apiKey = document.getElementById('openai-key').value;
      await this.saveSettings({ openaiApiKey: apiKey });
      modal.remove();
      this.showNotification('Settings saved successfully!');
    });
  }

  async saveRubric() {
    const rubricText = document.getElementById('rubric-input').value;
    if (!rubricText.trim()) {
      this.showNotification('Please enter a rubric', 'error');
      return;
    }
    
    let rubric = rubricText;
    
    // Check if it's a Google Sheets link
    if (rubricText.includes('docs.google.com/spreadsheets')) {
      try {
        rubric = await this.fetchGoogleSheetsData(rubricText);
      } catch (error) {
        this.showNotification('Failed to fetch Google Sheets data', 'error');
        return;
      }
    }
    
    // Save rubric to local storage
    await this.saveSettings({ rubric });
    this.showNotification('Rubric saved successfully!');
  }

  async fetchGoogleSheetsData(url) {
    // Convert Google Sheets URL to CSV export URL
    const sheetId = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    if (!sheetId) {
      throw new Error('Invalid Google Sheets URL');
    }
    
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch spreadsheet');
      }
      return await response.text();
    } catch (error) {
      throw new Error('Unable to access Google Sheets. Make sure the sheet is public.');
    }
  }

  async analyzeAllResponses() {
    const settings = await this.loadSettings();
    if (!settings.rubric) {
      this.showNotification('Please set a rubric first', 'error');
      return;
    }
    
    if (!settings.openaiApiKey) {
      this.showNotification('Please configure your OpenAI API key', 'error');
      return;
    }
    
    const resultsDiv = document.getElementById('analysis-results');
    resultsDiv.innerHTML = '<p>Analyzing responses...</p>';
    
    const analyses = [];
    
    for (const [studentId, response] of this.pollData) {
      try {
        const result = await this.sendMessage({
          type: 'ANALYZE_WITH_AI',
          data: {
            rubric: settings.rubric,
            studentResponse: JSON.stringify(response)
          }
        });
        
        analyses.push({
          studentId,
          response,
          analysis: result.result
        });
      } catch (error) {
        console.error('Analysis failed for student:', studentId, error);
      }
    }
    
    this.displayAnalysisResults(analyses);
  }

  displayAnalysisResults(analyses) {
    const resultsDiv = document.getElementById('analysis-results');
    
    if (analyses.length === 0) {
      resultsDiv.innerHTML = '<p>No responses to analyze</p>';
      return;
    }
    
    let html = '<div class="analysis-results">';
    
    analyses.forEach(({ studentId, analysis }) => {
      html += `
        <div class="student-analysis">
          <h5>Student ${studentId}</h5>
          ${analysis.score !== null ? `<div class="score">Score: ${analysis.score}/100</div>` : ''}
          <div class="comments"><strong>Comments:</strong> ${analysis.comments}</div>
          <div class="suggestions"><strong>Suggestions:</strong> ${analysis.suggestions}</div>
        </div>
      `;
    });
    
    html += '</div>';
    resultsDiv.innerHTML = html;
  }

  updateSidebar() {
    // Update responses list
    const responsesList = document.getElementById('responses-list');
    if (this.pollData.size === 0) {
      responsesList.innerHTML = '<p>No responses detected yet...</p>';
    } else {
      let html = '<div class="responses">';
      for (const [studentId, response] of this.pollData) {
        html += `
          <div class="response-item">
            <strong>Student ${studentId}</strong>
            <p>${JSON.stringify(response).substring(0, 100)}...</p>
          </div>
        `;
      }
      html += '</div>';
      responsesList.innerHTML = html;
    }
    
    // Update engagement metrics
    this.updateEngagementMetrics();
  }

  updateEngagementMetrics() {
    const metricsDiv = document.getElementById('engagement-metrics');
    
    const totalResponses = this.pollData.size;
    const avgResponseLength = Array.from(this.pollData.values())
      .reduce((sum, response) => sum + JSON.stringify(response).length, 0) / totalResponses || 0;
    
    metricsDiv.innerHTML = `
      <div class="metrics">
        <div class="metric">
          <span class="metric-label">Total Responses:</span>
          <span class="metric-value">${totalResponses}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Avg Response Length:</span>
          <span class="metric-value">${Math.round(avgResponseLength)} chars</span>
        </div>
      </div>
    `;
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.type) {
        case 'API_DATA':
          this.processApiData(request.data.url, request.data);
          break;
        case 'GET_STATUS':
          sendResponse({
            responsesCount: this.pollData.size,
            analyzedCount: document.querySelectorAll('.student-analysis').length
          });
          break;
        case 'OPEN_SIDEBAR':
          this.sidebar.classList.remove('collapsed');
          break;
        case 'OPEN_SETTINGS':
          this.openSettingsModal();
          break;
        case 'REFRESH_DATA':
          this.apiData = [];
          this.pollData.clear();
          this.updateSidebar();
          break;
      }
    });
  }

  async sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  async saveSettings(settings) {
    return this.sendMessage({
      type: 'SAVE_SETTINGS',
      settings
    });
  }

  async loadSettings() {
    const response = await this.sendMessage({ type: 'GET_SETTINGS' });
    return response.settings || {};
  }

  showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `minerva-notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }
}

// Initialize the content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new MinervaContentScript();
  });
} else {
  new MinervaContentScript();
}
