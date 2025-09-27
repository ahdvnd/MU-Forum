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
    
    // Parse the URL to get course/section/class info
    this.courseInfo = this.parseMinervaUrl(url);
    
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

  parseMinervaUrl(url) {
    // Parse URLs like: https://forum.minerva.edu/app/courses/3736/sections/12827/classes/95942
    const urlPattern = /\/app\/courses\/(\d+)(?:\/sections\/(\d+))?(?:\/classes\/(\d+))?/;
    const match = url.match(urlPattern);
    
    if (!match) {
      return { courseId: null, sectionId: null, classId: null };
    }
    
    return {
      courseId: match[1] || null,
      sectionId: match[2] || null, 
      classId: match[3] || null
    };
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
      
      #minerva-assistant-sidebar #rubric-input,
      #minerva-assistant-sidebar #question-input,
      #minerva-assistant-sidebar #answer-input {
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
      
      #minerva-assistant-sidebar #question-input {
        height: 80px !important;
      }
      
      #minerva-assistant-sidebar #answer-input {
        height: 100px !important;
      }
      
      #minerva-assistant-sidebar #rubric-input:focus,
      #minerva-assistant-sidebar #question-input:focus,
      #minerva-assistant-sidebar #answer-input:focus {
        outline: none !important;
        border-color: hsl(221.2 83.2% 53.3%) !important;
        box-shadow: 0 0 0 2px hsl(221.2 83.2% 53.3% / 0.2) !important;
      }
      
      #minerva-assistant-sidebar #rubric-input::placeholder,
      #minerva-assistant-sidebar #question-input::placeholder,
      #minerva-assistant-sidebar #answer-input::placeholder {
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
      
      /* Analysis Results Styles */
      #minerva-assistant-sidebar .analysis-results {
        margin-top: 16px !important;
      }
      
      #minerva-assistant-sidebar .student-analysis {
        background: hsl(210 40% 98%) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 16px !important;
      }
      
      #minerva-assistant-sidebar .student-analysis h5 {
        margin: 0 0 12px 0 !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      #minerva-assistant-sidebar .score {
        display: inline-block !important;
        padding: 4px 12px !important;
        border-radius: 6px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        margin-bottom: 12px !important;
      }
      
      #minerva-assistant-sidebar .score-excellent {
        background: hsl(142.1 76.2% 36.3% / 0.15) !important;
        color: hsl(142.1 76.2% 36.3%) !important;
        border: 1px solid hsl(142.1 76.2% 36.3% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .score-good {
        background: hsl(47.9 95.8% 53.1% / 0.15) !important;
        color: hsl(45.4 93.4% 47.5%) !important;
        border: 1px solid hsl(47.9 95.8% 53.1% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .score-needs-work {
        background: hsl(24.6 95% 53.1% / 0.15) !important;
        color: hsl(20.5 90.2% 48.2%) !important;
        border: 1px solid hsl(24.6 95% 53.1% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .score-poor {
        background: hsl(0 62.8% 30.6% / 0.15) !important;
        color: hsl(0 62.8% 30.6%) !important;
        border: 1px solid hsl(0 62.8% 30.6% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .comments {
        font-size: 13px !important;
        line-height: 1.5 !important;
        color: hsl(215.4 16.3% 46.9%) !important;
      }
      
      #minerva-assistant-sidebar .comments strong {
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      /* Analytics Dashboard Styles */
      #minerva-assistant-sidebar .analytics-summary {
        margin-bottom: 16px !important;
      }
      
      #minerva-assistant-sidebar .summary-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 12px !important;
      }
      
      #minerva-assistant-sidebar .summary-item {
        background: hsl(210 40% 98%) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 6px !important;
        padding: 12px !important;
        text-align: center !important;
      }
      
      #minerva-assistant-sidebar .summary-label {
        font-size: 11px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        font-weight: 500 !important;
        margin-bottom: 4px !important;
      }
      
      #minerva-assistant-sidebar .summary-value {
        font-size: 18px !important;
        font-weight: 700 !important;
        color: hsl(222.2 84% 4.9%) !important;
        margin-bottom: 2px !important;
      }
      
      #minerva-assistant-sidebar .summary-detail {
        font-size: 10px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
      }
      
      #minerva-assistant-sidebar .student-cards {
        max-height: 400px !important;
        overflow-y: auto !important;
      }
      
      #minerva-assistant-sidebar .student-card {
        background: hsl(210 40% 98%) !important;
        border: 1px solid hsl(214.3 31.8% 91.4%) !important;
        border-radius: 8px !important;
        padding: 16px !important;
        margin-bottom: 12px !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
      }
      
      #minerva-assistant-sidebar .student-card:hover {
        background: hsl(210 40% 96%) !important;
        border-color: hsl(214.3 31.8% 85%) !important;
      }
      
      #minerva-assistant-sidebar .student-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        margin-bottom: 12px !important;
        padding-bottom: 8px !important;
        border-bottom: 1px solid hsl(214.3 31.8% 91.4%) !important;
      }
      
      #minerva-assistant-sidebar .student-name {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      #minerva-assistant-sidebar .engagement-score {
        font-size: 12px !important;
        font-weight: 600 !important;
        padding: 4px 8px !important;
        border-radius: 4px !important;
        border: 1px solid !important;
      }
      
      #minerva-assistant-sidebar .engagement-score.excellent {
        background: hsl(142.1 76.2% 36.3% / 0.15) !important;
        color: hsl(142.1 76.2% 36.3%) !important;
        border-color: hsl(142.1 76.2% 36.3% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .engagement-score.good {
        background: hsl(47.9 95.8% 53.1% / 0.15) !important;
        color: hsl(45.4 93.4% 47.5%) !important;
        border-color: hsl(47.9 95.8% 53.1% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .engagement-score.needs-work {
        background: hsl(24.6 95% 53.1% / 0.15) !important;
        color: hsl(20.5 90.2% 48.2%) !important;
        border-color: hsl(24.6 95% 53.1% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .engagement-score.poor {
        background: hsl(0 62.8% 30.6% / 0.15) !important;
        color: hsl(0 62.8% 30.6%) !important;
        border-color: hsl(0 62.8% 30.6% / 0.3) !important;
      }
      
      #minerva-assistant-sidebar .student-metrics {
        display: grid !important;
        gap: 6px !important;
      }
      
      #minerva-assistant-sidebar .metric-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        font-size: 12px !important;
      }
      
      #minerva-assistant-sidebar .metric-label {
        color: hsl(215.4 16.3% 46.9%) !important;
        font-weight: 500 !important;
      }
      
      #minerva-assistant-sidebar .metric-value {
        color: hsl(222.2 84% 4.9%) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.good {
        color: hsl(142.1 76.2% 36.3%) !important;
      }
      
      #minerva-assistant-sidebar .metric-value.warning {
        color: hsl(38.4 92% 50%) !important;
      }
      
      #minerva-assistant-sidebar .metric-value.zero,
      #minerva-assistant-sidebar .metric-value.absent {
        color: hsl(0 62.8% 30.6%) !important;
      }
      
      #minerva-assistant-sidebar .error-text {
        color: hsl(0 62.8% 30.6%) !important;
        font-style: italic !important;
        text-align: center !important;
        padding: 20px !important;
      }
    `;
    
    document.head.appendChild(styleElement);
  }

  loadSidebarPage(pageName, classId = null) {
    this.currentPage = pageName;
    this.currentClassId = classId;
    
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
    
    // Update sidebar data based on page type
    if (pageName === 'grader') {
      this.updateSidebar();
      this.loadQuestionContext();
      this.loadSavedRubric();
    } else if (pageName === 'analytics' && classId) {
      this.loadAnalyticsData(classId);
    }
  }

  getSidebarPageContent(pageName) {
    switch (pageName) {
      case 'grader':
        return this.getGraderPageContent();
      case 'analytics':
        return this.getAnalyticsPageContent();
      case 'unavailable':
        return this.getUnavailablePageContent();
      default:
        return this.getGraderPageContent();
    }
  }

  getGraderPageContent() {
    return `
      <div class="section">
        <h4>Question Context</h4>
        <textarea id="question-input" placeholder="Enter the question or prompt that students are responding to..."></textarea>
        <textarea id="answer-input" placeholder="Enter the expected answer, key points, or sample response..."></textarea>
        <button id="save-context" class="btn">Save Context</button>
      </div>
      
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

  getAnalyticsPageContent() {
    return `
      <div class="section">
        <div class="section-header">
          <h4>Class Analytics</h4>
          <div class="header-buttons">
            <button id="refresh-analytics" class="btn-small btn-secondary">Refresh</button>
          </div>
        </div>
        <div id="class-summary">
          <p>Loading class metrics...</p>
        </div>
      </div>
      
      <div class="section">
        <h4>Student Engagement</h4>
        <div id="student-analytics">
          <p>Loading student data...</p>
        </div>
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
    
    // Page-specific events
    if (this.currentPage === 'grader') {
      this.setupGraderEvents();
    } else if (this.currentPage === 'analytics') {
      this.setupAnalyticsEvents();
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
    // Save context (question and answer)
    const saveContextBtn = document.getElementById('save-context');
    if (saveContextBtn) {
      saveContextBtn.addEventListener('click', () => {
        this.saveQuestionContext();
      });
    }
    
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

  setupAnalyticsEvents() {
    // Refresh analytics data
    const refreshBtn = document.getElementById('refresh-analytics');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (this.currentClassId) {
          this.loadAnalyticsData(this.currentClassId);
        }
      });
    }
  }

  clearAllResponses() {
    this.pollData.clear();
    this.updateSidebar();
    this.showNotification('All responses cleared', 'success');
  }

  async saveQuestionContext() {
    const questionText = document.getElementById('question-input').value.trim();
    const answerText = document.getElementById('answer-input').value.trim();
    
    if (!questionText && !answerText) {
      this.showNotification('Please enter question text or expected answer', 'error');
      return;
    }
    
    try {
      await this.saveSettings({ 
        questionText: questionText,
        expectedAnswer: answerText
      });
      this.showNotification('Question context saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving question context:', error);
      
      if (error.message && error.message.includes('Extension context invalidated')) {
        this.showNotification('Extension needs to be reloaded. Please refresh the page and try again.', 'error');
      } else {
        this.showNotification('Error saving question context. Please try again.', 'error');
      }
    }
  }

  async loadQuestionContext() {
    try {
      const settings = await this.loadSettings();
      
      const questionInput = document.getElementById('question-input');
      const answerInput = document.getElementById('answer-input');
      
      if (questionInput && settings.questionText) {
        questionInput.value = settings.questionText;
      }
      
      if (answerInput && settings.expectedAnswer) {
        answerInput.value = settings.expectedAnswer;
      }
    } catch (error) {
      console.error('Error loading question context:', error);
    }
  }

  async loadSavedRubric() {
    try {
      const settings = await this.loadSettings();
      
      const rubricInput = document.getElementById('rubric-input');
      
      if (rubricInput && settings.rubric) {
        rubricInput.value = settings.rubric;
      }
    } catch (error) {
      console.error('Error loading saved rubric:', error);
    }
  }

  async loadAnalyticsData(classId) {
    try {
      const response = await fetch(`https://forum.minerva.edu/api/v1/analytics/class/${classId}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Analytics API error: ${response.status}`);
      }

      const analyticsData = await response.json();
      this.displayAnalyticsData(analyticsData);
      
    } catch (error) {
      console.error('Error loading analytics data:', error);
      this.showNotification('Failed to load analytics data', 'error');
      
      // Show error in the analytics containers
      const classSummary = document.getElementById('class-summary');
      const studentAnalytics = document.getElementById('student-analytics');
      
      if (classSummary) {
        classSummary.innerHTML = '<p class="error-text">Failed to load class metrics</p>';
      }
      
      if (studentAnalytics) {
        studentAnalytics.innerHTML = '<p class="error-text">Failed to load student data</p>';
      }
    }
  }

  displayAnalyticsData(data) {
    this.displayClassSummary(data);
    this.displayStudentEngagement(data['user-engagement'] || data.userEngagement || []);
  }

  displayClassSummary(data) {
    const classSummary = document.getElementById('class-summary');
    if (!classSummary) return;

    const instructorTalkTime = data['instructor-talk-time-summary'] || data.instructorTalkTimesSummary;
    const studentTalkTime = data['student-talk-time-summary'] || data.studentTalkTimeSummary;
    const attendance = data['attendance-summary'] || data.attendanceSummary;
    const breakouts = data['breakout-summary'] || data.breakoutSummary;
    const polls = data['polls-summary'] || data.pollsSummary;

    classSummary.innerHTML = `
      <div class="analytics-summary">
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-label">Instructor Talk Time</div>
            <div class="summary-value">${instructorTalkTime?.percentage || 0}%</div>
            <div class="summary-detail">${Math.round((instructorTalkTime?.['summary-value'] || instructorTalkTime?.summaryValue || 0) / 60)} minutes</div>
          </div>
          
          <div class="summary-item">
            <div class="summary-label">Student Talk Time</div>
            <div class="summary-value">${studentTalkTime?.percentage || 0}%</div>
            <div class="summary-detail">Avg: ${studentTalkTime?.['summary-value'] || studentTalkTime?.summaryValue || 0}s per student</div>
          </div>
          
          <div class="summary-item">
            <div class="summary-label">Attendance</div>
            <div class="summary-value">${(attendance?.['total-class-users'] || attendance?.totalClassUsers || 0) - (attendance?.['total-absences'] || attendance?.totalAbsences || 0)}/${attendance?.['total-class-users'] || attendance?.totalClassUsers || 0}</div>
            <div class="summary-detail">${attendance?.['total-absences'] || attendance?.totalAbsences || 0} absent</div>
          </div>
          
          <div class="summary-item">
            <div class="summary-label">Breakouts</div>
            <div class="summary-value">${breakouts?.['num-breakouts'] || breakouts?.numBreakouts || 0}</div>
            <div class="summary-detail">${Math.round((breakouts?.['breakout-duration-in-seconds'] || breakouts?.breakoutDurationInSeconds || 0) / 60)} min total</div>
          </div>
          
          <div class="summary-item">
            <div class="summary-label">Polls</div>
            <div class="summary-value">${polls?.['polls-count'] || polls?.pollsCount || 0}</div>
            <div class="summary-detail">Class ${polls?.['class-count'] || polls?.classCount || 0}</div>
          </div>
        </div>
      </div>
    `;
  }

  displayStudentEngagement(students) {
    const studentAnalytics = document.getElementById('student-analytics');
    if (!studentAnalytics) return;

    if (!students.length) {
      studentAnalytics.innerHTML = '<p>No student engagement data available</p>';
      return;
    }

    // Sort students by engagement score (calculated from multiple metrics)
    const sortedStudents = students.sort((a, b) => {
      const scoreA = this.calculateEngagementScore(a);
      const scoreB = this.calculateEngagementScore(b);
      return scoreB - scoreA;
    });

    let html = '<div class="student-cards">';
    
    sortedStudents.forEach(student => {
      const engagementScore = this.calculateEngagementScore(student);
      const talkTime = student['talk-time'] || student.talkTime || {};
      const breakoutTalkTime = student['breakout-talk-time'] || student.breakoutTalkTime || {};
      
      html += `
        <div class="student-card">
          <div class="student-header">
            <div class="student-name">${student.user?.['first-name'] || student.user?.firstName || 'Unknown'} ${student.user?.['last-name'] || student.user?.lastName || ''}</div>
          </div>
          
          <div class="student-metrics">
            <div class="metric-row">
              <span class="metric-label">Talk Time:</span>
              <span class="metric-value ${talkTime.status?.toLowerCase()}">${talkTime['duration-seconds'] || talkTime.durationSeconds || 0}s (${talkTime.status || 'UNKNOWN'})</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Breakout Talk:</span>
              <span class="metric-value ${breakoutTalkTime.status?.toLowerCase()}">${breakoutTalkTime['duration-seconds'] || breakoutTalkTime.durationSeconds || 0}s (${breakoutTalkTime.status || 'UNKNOWN'})</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Focus:</span>
              <span class="metric-value">${Math.round(student['window-focus-percentage'] || student.windowFocusPercentage || 0)}%</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Hand Raises:</span>
              <span class="metric-value">${student['hand-raises'] || student.handRaises || 0}</span>
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    studentAnalytics.innerHTML = html;
  }

  calculateEngagementScore(student) {
    // Calculate a composite engagement score from various metrics
    let score = 0;
    
    // Focus percentage (40% weight)
    const focusPercentage = student['window-focus-percentage'] || student.windowFocusPercentage || 0;
    score += focusPercentage * 0.4;
    
    // Talk time status (30% weight)
    const talkTime = student['talk-time'] || student.talkTime || {};
    const talkTimeScore = this.getStatusScore(talkTime.status);
    score += talkTimeScore * 30 * 0.3;
    
    // Breakout talk time status (20% weight)
    const breakoutTalkTime = student['breakout-talk-time'] || student.breakoutTalkTime || {};
    const breakoutScore = this.getStatusScore(breakoutTalkTime.status);
    score += breakoutScore * 30 * 0.2;
    
    // Activity metrics (10% weight)
    const reactions = student.reactions || 0;
    const handRaises = student['hand-raises'] || student.handRaises || 0;
    const chatMessages = student['chat-messages'] || student.chatMessages || 0;
    
    const activityScore = Math.min(100, 
      (reactions * 2) + 
      (handRaises * 5) + 
      (chatMessages * 3)
    );
    score += activityScore * 0.1;
    
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  getStatusScore(status) {
    switch(status) {
      case 'GOOD': return 100;
      case 'WARNING': return 60;
      case 'ZERO': return 20;
      case 'ABSENT': return 0;
      default: return 50;
    }
  }

  getEngagementClass(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'needs-work';
    return 'poor';
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
          <div class="security-info" style="background: #fef3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin: 12px 0; font-size: 13px;">
            <strong>🔒 Security Notice:</strong><br>
            • Your API key is encrypted and stored locally in your browser<br>
            • It's never transmitted to any server except OpenAI's API<br>
            • For maximum security, consider using a restricted API key with limited permissions<br>
            • You can revoke this key anytime in your OpenAI dashboard
          </div>
          <p class="help-text">Your API key is encrypted before storage and never shared with third parties.</p>
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
      const apiKey = document.getElementById('openai-key').value.trim();
      
      if (!apiKey) {
        this.showNotification('Please enter an API key', 'error');
        return;
      }
      
      try {
        await this.saveSettings({ openaiApiKey: apiKey });
        
        // Verify the settings were saved by loading them back
        const savedSettings = await this.loadSettings();
        if (savedSettings.openaiApiKey === apiKey) {
          this.showNotification('API key saved successfully!', 'success');
          modal.remove();
        } else {
          this.showNotification('Failed to save API key - please try again', 'error');
        }
      } catch (error) {
        console.error('Error saving settings:', error);
        this.showNotification('Error saving settings', 'error');
      }
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
    
    try {
      // Save rubric to local storage
      await this.saveSettings({ rubric });
      this.showNotification('Rubric saved successfully!', 'success');
    } catch (error) {
      console.error('Error saving rubric:', error);
      
      if (error.message && error.message.includes('Extension context invalidated')) {
        this.showNotification('Extension needs to be reloaded. Please refresh the page and try again.', 'error');
      } else {
        this.showNotification('Error saving rubric. Please try again.', 'error');
      }
    }
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
    
    // Get current question context from the form
    const questionText = document.getElementById('question-input')?.value.trim() || settings.questionText || '';
    const expectedAnswer = document.getElementById('answer-input')?.value.trim() || settings.expectedAnswer || '';
    
    for (const [studentId, response] of this.pollData) {
      try {
        const result = await this.sendMessage({
          type: 'ANALYZE_WITH_AI',
          data: {
            rubric: settings.rubric,
            questionText: questionText,
            expectedAnswer: expectedAnswer,
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
      // Determine score color based on 1-5 scale
      let scoreClass = '';
      if (analysis.score >= 4) scoreClass = 'score-excellent';
      else if (analysis.score === 3) scoreClass = 'score-good';
      else if (analysis.score >= 2) scoreClass = 'score-needs-work';
      else scoreClass = 'score-poor';
      
      html += `
        <div class="student-analysis">
          <h5>Student ${studentId}</h5>
          ${analysis.score !== null ? `<div class="score ${scoreClass}">Score: ${analysis.score}/5</div>` : ''}
          <div class="comments"><strong>Feedback:</strong> ${analysis.comments}</div>
        </div>
      `;
    });
    
    html += '</div>';
    resultsDiv.innerHTML = html;
  }

  updateSidebar() {
    // Update responses list - check if element exists first
    const responsesList = document.getElementById('responses-list');
    if (!responsesList) {
      console.log('Responses list element not found - sidebar may not be loaded yet');
      return;
    }
    
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
         case 'SHOW_ANALYTICS':
           this.loadSidebarPage('analytics', request.classId);
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

  async checkBackgroundScript() {
    try {
      await this.sendMessage({ type: 'PING' }, 1);
      return true;
    } catch (error) {
      return false;
    }
  }

  async sendMessage(message, retries = 3) {
    return new Promise((resolve, reject) => {
      const attemptSend = (attemptsLeft) => {
        try {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              console.log('Runtime error:', chrome.runtime.lastError.message);
              
              // If extension context is invalidated, try to reload the page or retry
              if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
                if (attemptsLeft > 0) {
                  console.log(`Extension context invalidated, retrying... ${attemptsLeft} attempts left`);
                  setTimeout(() => attemptSend(attemptsLeft - 1), 200);
                  return;
                } else {
                  // If all retries failed, suggest page refresh
                  reject(new Error('Extension context invalidated. Please refresh the page to reconnect.'));
                  return;
                }
              }
              
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        } catch (error) {
          if (attemptsLeft > 0) {
            console.log(`Send attempt failed, retrying... ${attemptsLeft} attempts left`);
            setTimeout(() => attemptSend(attemptsLeft - 1), 200);
          } else {
            reject(error);
          }
        }
      };
      
      attemptSend(retries);
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
