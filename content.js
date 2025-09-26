// Content script for Minerva Forum Assistant
class MinervaContentScript {
  constructor() {
    this.sidebar = null;
    this.apiData = [];
    this.pollData = new Map();
    this.currentPage = this.determinePageType(); // Determine page based on URL
    this.setupInterception();
    this.createSidebar();
    this.setupMessageListener();
    this.setupTextSelection();
  }

  setupTextSelection() {
    // Only enable text selection capture on review pages
    if (!this.isReviewPage) {
      return;
    }

    // Add text selection listener - only for our extension functionality
    document.addEventListener('mouseup', (event) => {
      // Only handle if not clicking on our extension elements
      if (!event.target.closest('.minerva-sidebar, .minerva-modal, .minerva-notification')) {
        this.handleTextSelection();
      }
    });

    // Also handle keyboard selection (Shift+Arrow keys, etc.)
    document.addEventListener('keyup', (event) => {
      // Only handle if not focused on our extension elements
      if (!document.activeElement.closest('.minerva-sidebar, .minerva-modal, .minerva-notification')) {
        if (event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          this.handleTextSelection();
        }
      }
    });
  }

  handleTextSelection() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    // Only process if there's meaningful text selected (more than 10 characters)
    if (selectedText.length > 10) {
      this.addSelectedTextToResponses(selectedText);
    }
  }

  addSelectedTextToResponses(text) {
    // Remove any previously selected text
    this.clearSelectedText();
    
    // Generate a unique ID for this response
    const responseId = `selected_${Date.now()}`;
    
    // Add to poll data with metadata
    this.pollData.set(responseId, {
      text: text,
      source: 'text_selection',
      timestamp: new Date().toISOString(),
      length: text.length,
      student_id: responseId
    });

    // Update the sidebar if it's showing the grader page
    if (this.currentPage === 'grader') {
      this.updateSidebar();
    }

    // Show a brief notification
    this.showNotification(`Selected text captured (${text.length} chars)`, 'success');
  }

  clearSelectedText() {
    // Remove all previously selected text entries
    for (const [key, value] of this.pollData) {
      if (value.source === 'text_selection') {
        this.pollData.delete(key);
      }
    }
  }

  determinePageType() {
    const url = window.location.href;
    
    // Check if this is a review page with the specific pattern
    const reviewPagePattern = /\/app\/courses\/\d+\/sections\/\d+\/classes\/\d+\/review/;
    if (reviewPagePattern.test(url)) {
      this.isReviewPage = true;
      return 'grader';
    }
    
    // Check if this is other grading-related pages
    if (url.includes('/grading') || 
        url.includes('/responses') ||
        url.includes('/assignments')) {
      this.isReviewPage = false;
      return 'grader';
    }
    
    // Default to unavailable for other pages
    this.isReviewPage = false;
    return 'unavailable';
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
    this.sidebar.className = 'minerva-sidebar collapsed';
    
    // Inject our CSS only when sidebar is created
    this.injectExtensionCSS();
    
    // Add sidebar to page
    document.body.appendChild(this.sidebar);
    
    // Load the current page content
    this.loadSidebarPage(this.currentPage);
  }

  injectExtensionCSS() {
    // Only inject CSS once
    if (document.getElementById('minerva-extension-styles')) {
      return;
    }

    // Create completely isolated CSS that ONLY affects our extension
    const styleElement = document.createElement('style');
    styleElement.id = 'minerva-extension-styles';
    
    // Restore the beautiful shadCN styling but with complete isolation
    styleElement.textContent = `
      /* MINERVA EXTENSION - RESTORED SHADCN STYLING - ISOLATED */
      #minerva-assistant-sidebar {
        all: initial !important;
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        width: 380px !important;
        height: 100vh !important;
        background: hsl(0 0% 100%) !important;
        border-left: 1px solid hsl(214.3 31.8% 91.4%) !important;
        box-shadow: -4px 0 24px -4px rgba(0, 0, 0, 0.08), -2px 0 8px -2px rgba(0, 0, 0, 0.04) !important;
        z-index: 10000 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
        font-size: 14px !important;
        line-height: 1.5 !important;
        transform: translateX(100%) !important;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        overflow-y: auto !important;
        box-sizing: border-box !important;
        display: block !important;
      }
      
      #minerva-assistant-sidebar:not(.collapsed) {
        transform: translateX(0) !important;
      }
      
      #minerva-assistant-sidebar * {
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }
      
      #minerva-assistant-sidebar .sidebar-header {
        background: hsl(0 0% 100%) !important;
        border-bottom: 1px solid hsl(214.3 31.8% 91.4%) !important;
        color: hsl(222.2 84% 4.9%) !important;
        padding: 20px 24px 16px 24px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        position: sticky !important;
        top: 0 !important;
        z-index: 10001 !important;
        backdrop-filter: blur(8px) !important;
        background: hsl(0 0% 100% / 0.95) !important;
      }
      
      #minerva-assistant-sidebar .sidebar-header h3 {
        margin: 0 !important;
        font-size: 18px !important;
        font-weight: 600 !important;
        letter-spacing: -0.025em !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      #minerva-assistant-sidebar .header-controls {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }
      
      #minerva-assistant-sidebar .close-btn {
        background: none !important;
        border: none !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        font-size: 18px !important;
        cursor: pointer !important;
        padding: 0 !important;
        width: 32px !important;
        height: 32px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 6px !important;
        line-height: 1 !important;
        user-select: none !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      
      #minerva-assistant-sidebar .close-btn:hover {
        background-color: hsl(210 40% 98%) !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      #minerva-assistant-sidebar .close-btn:active {
        background-color: hsl(210 40% 96%) !important;
        transform: scale(0.98) !important;
      }
      
      #minerva-assistant-sidebar .sidebar-content {
        padding: 0 !important;
      }
      
      #minerva-assistant-sidebar .section {
        padding: 24px !important;
        border-bottom: 1px solid hsl(214.3 31.8% 91.4%) !important;
      }
      
      #minerva-assistant-sidebar .section:last-child {
        border-bottom: none !important;
        padding-bottom: 32px !important;
      }
      
      #minerva-assistant-sidebar .section h4 {
        margin: 0 0 16px 0 !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
        letter-spacing: -0.025em !important;
      }
      
      #minerva-assistant-sidebar .section-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 16px !important;
      }
      
      #minerva-assistant-sidebar .section-header h4 {
        margin: 0 !important;
      }
      
      #minerva-assistant-sidebar .header-buttons {
        display: flex !important;
        gap: 6px !important;
        align-items: center !important;
      }
      
      #minerva-assistant-sidebar .btn {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 6px !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
        cursor: pointer !important;
        border: 1px solid transparent !important;
        padding: 8px 16px !important;
        height: 36px !important;
        background: hsl(222.2 84% 4.9%) !important;
        color: hsl(210 40% 98%) !important;
        margin-right: 8px !important;
        margin-bottom: 8px !important;
        text-decoration: none !important;
        user-select: none !important;
      }
      
      #minerva-assistant-sidebar .btn:hover {
        background: hsl(222.2 84% 4.9% / 0.9) !important;
      }
      
      #minerva-assistant-sidebar .btn:active {
        transform: scale(0.98) !important;
      }
      
      #minerva-assistant-sidebar .btn-primary {
        background: hsl(142.1 76.2% 36.3%) !important;
        color: hsl(355.7 100% 97.3%) !important;
      }
      
      #minerva-assistant-sidebar .btn-primary:hover {
        background: hsl(142.1 76.2% 36.3% / 0.9) !important;
      }
      
      #minerva-assistant-sidebar .btn-secondary {
        background: hsl(210 40% 98%) !important;
        color: hsl(222.2 84% 4.9%) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
      }
      
      #minerva-assistant-sidebar .btn-secondary:hover {
        background: hsl(210 40% 96%) !important;
      }
      
      #minerva-assistant-sidebar .btn-small {
        padding: 4px 8px !important;
        height: 24px !important;
        font-size: 11px !important;
        min-width: auto !important;
      }
      
      #minerva-assistant-sidebar #rubric-input {
        width: 100% !important;
        height: 120px !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 6px !important;
        padding: 12px !important;
        font-size: 14px !important;
        font-family: inherit !important;
        resize: vertical !important;
        margin-bottom: 16px !important;
        background: hsl(0 0% 100%) !important;
        color: hsl(222.2 84% 4.9%) !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
        line-height: 1.5 !important;
      }
      
      #minerva-assistant-sidebar #rubric-input:focus {
        outline: none !important;
        border-color: hsl(221.2 83.2% 53.3%) !important;
        box-shadow: 0 0 0 2px hsl(221.2 83.2% 53.3% / 0.2) !important;
      }
      
      #minerva-assistant-sidebar #rubric-input::placeholder {
        color: hsl(215.4 16.3% 46.9%) !important;
      }
      
      #minerva-assistant-sidebar .responses {
        max-height: 200px !important;
        overflow-y: auto !important;
        border-radius: 6px !important;
      }
      
      #minerva-assistant-sidebar .response-item {
        background: hsl(210 40% 98%) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 6px !important;
        padding: 12px !important;
        margin-bottom: 8px !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      
      #minerva-assistant-sidebar .response-item:hover {
        background: hsl(210 40% 96%) !important;
      }
      
      #minerva-assistant-sidebar .response-item.selected-text {
        border-left: 3px solid hsl(142.1 76.2% 36.3%) !important;
        background: hsl(142.1 76.2% 36.3% / 0.05) !important;
      }
      
      #minerva-assistant-sidebar .response-item.selected-text:hover {
        background: hsl(142.1 76.2% 36.3% / 0.08) !important;
      }
      
      #minerva-assistant-sidebar .response-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 8px !important;
      }
      
      #minerva-assistant-sidebar .response-source {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
      }
      
      #minerva-assistant-sidebar .response-length {
        font-size: 11px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        background: hsl(210 40% 96%) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
      }
      
      #minerva-assistant-sidebar .response-text {
        margin: 0 !important;
        font-size: 13px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        line-height: 1.5 !important;
      }
      
      #minerva-assistant-sidebar .response-timestamp {
        font-size: 11px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        margin-top: 6px !important;
        font-style: italic !important;
      }
      
      
      #minerva-assistant-sidebar .unavailable-section {
        text-align: center !important;
        padding: 40px 24px !important;
      }
      
      #minerva-assistant-sidebar .unavailable-content {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 16px !important;
      }
      
      #minerva-assistant-sidebar .unavailable-icon {
        font-size: 48px !important;
        opacity: 0.6 !important;
        margin-bottom: 8px !important;
      }
      
      #minerva-assistant-sidebar .unavailable-content h4 {
        margin: 0 !important;
        font-size: 18px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
        letter-spacing: -0.025em !important;
      }
      
      #minerva-assistant-sidebar .unavailable-content p {
        margin: 0 !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        line-height: 1.5 !important;
      }
      
      #minerva-assistant-sidebar .unavailable-description {
        font-size: 13px !important;
        max-width: 280px !important;
        margin-top: 8px !important;
      }
      
      /* Modal Styles - Also isolated */
      .minerva-modal {
        all: initial !important;
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        background: hsl(0 0% 0% / 0.5) !important;
        backdrop-filter: blur(4px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 20000 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }
      
      .minerva-modal .modal-content {
        background: hsl(0 0% 100%) !important;
        border-radius: 12px !important;
        width: 90% !important;
        max-width: 500px !important;
        max-height: 90vh !important;
        overflow-y: auto !important;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
      }
      
      .minerva-modal .modal-header {
        background: hsl(0 0% 100%) !important;
        color: hsl(222.2 84% 4.9%) !important;
        padding: 24px 24px 0 24px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        border-radius: 12px 12px 0 0 !important;
      }
      
      .minerva-modal .modal-header h3 {
        margin: 0 !important;
        font-size: 18px !important;
        font-weight: 600 !important;
        letter-spacing: -0.025em !important;
      }
      
      .minerva-modal .close-modal {
        background: none !important;
        border: none !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        font-size: 18px !important;
        cursor: pointer !important;
        padding: 0 !important;
        width: 32px !important;
        height: 32px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 6px !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      
      .minerva-modal .close-modal:hover {
        background: hsl(210 40% 98%) !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      .minerva-modal .modal-body {
        padding: 24px 24px 16px 24px !important;
      }
      
      .minerva-modal .modal-body label {
        display: block !important;
        margin-bottom: 8px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
        font-size: 14px !important;
      }
      
      .minerva-modal .modal-body input {
        width: 100% !important;
        padding: 12px !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 6px !important;
        font-size: 14px !important;
        margin-bottom: 8px !important;
        background: hsl(0 0% 100%) !important;
        color: hsl(222.2 84% 4.9%) !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
        box-sizing: border-box !important;
        font-family: inherit !important;
      }
      
      .minerva-modal .modal-body input:focus {
        outline: none !important;
        border-color: hsl(221.2 83.2% 53.3%) !important;
        box-shadow: 0 0 0 2px hsl(221.2 83.2% 53.3% / 0.2) !important;
      }
      
      .minerva-modal .help-text {
        font-size: 13px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        margin: 0 !important;
        line-height: 1.5 !important;
      }
      
      .minerva-modal .modal-footer {
        padding: 20px 24px 24px 24px !important;
        border-top: 1px solid hsl(214.3 31.8% 91.4%) !important;
        display: flex !important;
        justify-content: flex-end !important;
        gap: 12px !important;
        margin-top: 0 !important;
      }
      
      .minerva-modal .modal-footer .btn {
        margin-right: 0 !important;
        margin-bottom: 0 !important;
        min-width: 80px !important;
      }
      
      /* Notification Styles */
      .minerva-notification {
        all: initial !important;
        position: fixed !important;
        top: 24px !important;
        right: 24px !important;
        padding: 16px 20px !important;
        border-radius: 8px !important;
        font-weight: 500 !important;
        z-index: 30000 !important;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
        border: 1px solid !important;
        font-size: 14px !important;
        line-height: 1.5 !important;
        max-width: 400px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }
      
      .minerva-notification.success {
        background: hsl(142.1 76.2% 36.3% / 0.1) !important;
        color: hsl(142.1 76.2% 36.3%) !important;
        border-color: hsl(142.1 76.2% 36.3% / 0.3) !important;
      }
      
      .minerva-notification.error {
        background: hsl(0 62.8% 30.6% / 0.1) !important;
        color: hsl(0 62.8% 30.6%) !important;
        border-color: hsl(0 62.8% 30.6% / 0.3) !important;
      }
    `;
    
    document.head.appendChild(styleElement);
  }

  loadSidebarPage(pageName) {
    this.currentPage = pageName;
    
    // Get the page content
    const pageContent = this.getSidebarPageContent(pageName);
    
    // Update sidebar content
    this.sidebar.innerHTML = `
      <div class="sidebar-header">
        <h3>Minerva Assistant</h3>
        <div class="header-controls">
          <button id="close-sidebar" class="close-btn" title="Close Sidebar">×</button>
        </div>
      </div>
      <div class="sidebar-content">
        ${pageContent}
      </div>
    `;
    
    // Setup event listeners based on current page
    this.setupSidebarEvents();
    
    // Ensure close button works
    this.ensureCloseButtonWorks();
    
    // Update sidebar data if on grader page
    if (pageName === 'grader') {
      this.updateSidebar();
    }
  }

  getSidebarPageContent(pageName) {
    switch (pageName) {
      case 'grader':
        return this.getGraderPageContent();
      case 'unavailable':
        return this.getUnavailablePageContent();
      default:
        return this.getGraderPageContent();
    }
  }

  getGraderPageContent() {
    return `
      <div class="section">
        <h4>Rubric</h4>
        <textarea id="rubric-input" placeholder="Enter your rubric here or paste Google Sheets link..."></textarea>
        <button id="save-rubric" class="btn">Save Rubric</button>
      </div>
      
      <div class="section">
        <div class="section-header">
          <h4>Student Responses</h4>
          <div class="header-buttons">
            <button id="clear-selected" class="btn-small btn-secondary" title="Clear selected text only">Clear Selected</button>
            <button id="clear-all-responses" class="btn-small btn-secondary" title="Clear all responses">Clear All</button>
          </div>
        </div>
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
        <button id="close-sidebar-bottom" class="btn btn-secondary">Close Sidebar</button>
      </div>
    `;
  }

  getUnavailablePageContent() {
    return `
      <div class="section unavailable-section">
        <div class="unavailable-content">
          <div class="unavailable-icon">📄</div>
          <h4>Nothing Available</h4>
          <p>Nothing available for this page</p>
          <p class="unavailable-description">
            The Minerva Assistant doesn't have any grading tools available for this page. 
            Navigate to a page with student responses or assignments to use the grading features.
          </p>
        </div>
        
        <div class="section">
          <button id="close-sidebar-bottom" class="btn btn-secondary">Close Sidebar</button>
        </div>
      </div>
    `;
  }

  ensureCloseButtonWorks() {
    // Double-check that close button exists and is functional
    const closeBtn = document.getElementById('close-sidebar');
    if (!closeBtn) {
      console.error('Close button not found! Adding manually...');
      const header = this.sidebar.querySelector('.sidebar-header');
      const controls = header.querySelector('.header-controls');
      if (controls) {
        controls.innerHTML = '<button id="close-sidebar" class="close-btn" title="Close Sidebar">×</button>';
        // Re-add event listener
        document.getElementById('close-sidebar').addEventListener('click', () => {
          this.closeSidebar();
        });
      }
    }
  }

  closeSidebar() {
    this.sidebar.classList.add('collapsed');
    console.log('Sidebar closed');
    // Optional: Show a brief notification
    // this.showNotification('Sidebar closed', 'success');
  }

  setupSidebarEvents() {
    // Close sidebar (header button) - always present
    document.getElementById('close-sidebar').addEventListener('click', () => {
      this.closeSidebar();
    });
    
    // Close sidebar (bottom button) - always present
    const bottomCloseBtn = document.getElementById('close-sidebar-bottom');
    if (bottomCloseBtn) {
      bottomCloseBtn.addEventListener('click', () => {
        this.closeSidebar();
      });
    }
    
    // Grader-specific events
    if (this.currentPage === 'grader') {
      this.setupGraderEvents();
    }
    
    // Close sidebar with Escape key - only when sidebar is open
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.sidebar.classList.contains('collapsed')) {
        // Only close if escape is pressed and sidebar is visible
        // This is a reasonable extension behavior and won't interfere with main site
        this.closeSidebar();
      }
    });
  }

  setupGraderEvents() {
    // Save rubric
    const saveRubricBtn = document.getElementById('save-rubric');
    if (saveRubricBtn) {
      saveRubricBtn.addEventListener('click', () => {
        this.saveRubric();
      });
    }
    
    // Analyze responses
    const analyzeBtn = document.getElementById('analyze-responses');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        this.analyzeAllResponses();
      });
    }

    // Clear selected text only
    const clearSelectedBtn = document.getElementById('clear-selected');
    if (clearSelectedBtn) {
      clearSelectedBtn.addEventListener('click', () => {
        this.clearSelectedText();
        this.updateSidebar();
        this.showNotification('Selected text cleared', 'success');
      });
    }

    // Clear all responses
    const clearAllBtn = document.getElementById('clear-all-responses');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.clearAllResponses();
      });
    }
  }

  clearAllResponses() {
    this.pollData.clear();
    this.updateSidebar();
    this.showNotification('All responses cleared', 'success');
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
          <button class="close-modal btn btn-secondary">Cancel</button>
          <button id="save-settings" class="btn btn-primary">Save</button>
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
        const isSelected = response.source === 'text_selection';
        const displayText = isSelected ? response.text : JSON.stringify(response);
        const truncatedText = displayText.length > 150 ? displayText.substring(0, 150) + '...' : displayText;
        const sourceLabel = isSelected ? 'Selected Text' : `Student ${studentId}`;
        const sourceIcon = isSelected ? '✂️' : '👤';
        
        html += `
          <div class="response-item ${isSelected ? 'selected-text' : ''}">
            <div class="response-header">
              <span class="response-source">${sourceIcon} ${sourceLabel}</span>
              ${isSelected ? `<span class="response-length">${response.length} chars</span>` : ''}
            </div>
            <p class="response-text">${truncatedText}</p>
            ${isSelected ? `<div class="response-timestamp">${new Date(response.timestamp).toLocaleTimeString()}</div>` : ''}
          </div>
        `;
      }
      html += '</div>';
      responsesList.innerHTML = html;
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
         case 'SHOW_SIDEBAR':
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_GRADER':
           this.loadSidebarPage('grader');
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_UNAVAILABLE':
           this.loadSidebarPage('unavailable');
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
