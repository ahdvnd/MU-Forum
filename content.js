// Content script for Minerva Forum Assistant
class MinervaContentScript {
  constructor() {
    this.sidebar = null;
    this.apiData = [];
    this.pollData = new Map();
    this.currentPage = this.determinePageType(); // Determine page based on URL
    this.setupInterception();
    // Don't create sidebar automatically - only when user requests it
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

  ensureSidebarExists() {
    // Only create sidebar if it doesn't exist
    if (!this.sidebar) {
      this.createSidebar();
    }
  }

  createSidebar() {
    // Create sidebar container
    this.sidebar = document.createElement('div');
    this.sidebar.id = 'minerva-assistant-sidebar';
    this.sidebar.className = 'minerva-sidebar collapsed';
    
    // Inject our CSS only when sidebar is created
    this.injectExtensionCSS();
    
    // Modify page layout to make room for sidebar
    this.adjustPageLayout();
    
    // Add sidebar to page
    document.body.appendChild(this.sidebar);
    
    // Load the current page content
    this.loadSidebarPage(this.currentPage);
  }

  adjustPageLayout() {
    // Always add the class to body to trigger CSS layout changes
      document.body.classList.add('minerva-sidebar-active');
    
    // Also add to html element for broader coverage
    document.documentElement.classList.add('minerva-sidebar-active');
  }

  removeSidebarLayout() {
    // Remove layout adjustments when sidebar is closed
      document.body.classList.remove('minerva-sidebar-active');
    document.documentElement.classList.remove('minerva-sidebar-active');
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
      /* MINERVA EXTENSION - COLOR VARIABLES */
      :root {
        --minerva-gray: #676767;
        --minerva-red: #DF2E25;
        --minerva-orange: #F0871D;
        --minerva-green: #33AB6F;
        --minerva-blue: #0978BE;
        --minerva-purple: #5B3E97;
      }
      
      /* MINERVA EXTENSION - EMBEDDED SIDEBAR STYLING */
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
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        overflow-y: auto !important;
        box-sizing: border-box !important;
        display: block !important;
      }
      
      #minerva-assistant-sidebar:not(.collapsed) {
        transform: translateX(0) !important;
      }
      
      /* Adjust page layout when sidebar is active - Push entire page */
      body:has(#minerva-assistant-sidebar:not(.collapsed)) {
        margin-right: 380px !important;
        transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        width: calc(100vw - 380px) !important;
        overflow-x: hidden !important;
      }
      
      /* Alternative fallback for older browsers */
      body.minerva-sidebar-active {
        margin-right: 380px !important;
        transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        width: calc(100vw - 380px) !important;
        overflow-x: hidden !important;
      }
      
      /* Ensure all top-level containers are affected */
      body:has(#minerva-assistant-sidebar:not(.collapsed)) > *,
      body.minerva-sidebar-active > * {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      
      /* Specifically target common page structures */
      body:has(#minerva-assistant-sidebar:not(.collapsed)) header,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) nav,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) main,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .main-content,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) #main,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) [role="main"],
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .page-container,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .app-container,
      body.minerva-sidebar-active header,
      body.minerva-sidebar-active nav,
      body.minerva-sidebar-active main,
      body.minerva-sidebar-active .main-content,
      body.minerva-sidebar-active #main,
      body.minerva-sidebar-active [role="main"],
      body.minerva-sidebar-active .page-container,
      body.minerva-sidebar-active .app-container {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      
      /* Prevent any fixed/absolute positioned elements from overlapping */
      body:has(#minerva-assistant-sidebar:not(.collapsed)) [style*="position: fixed"],
      body:has(#minerva-assistant-sidebar:not(.collapsed)) [style*="position: absolute"],
      body.minerva-sidebar-active [style*="position: fixed"],
      body.minerva-sidebar-active [style*="position: absolute"] {
        max-width: calc(100vw - 380px) !important;
      }
      
      /* Minerva Forum specific adjustments */
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .navbar,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .header,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .topbar,
      body:has(#minerva-assistant-sidebar:not(.collapsed)) .menu,
      body.minerva-sidebar-active .navbar,
      body.minerva-sidebar-active .header,
      body.minerva-sidebar-active .topbar,
      body.minerva-sidebar-active .menu {
        width: calc(100vw - 380px) !important;
        max-width: calc(100vw - 380px) !important;
        box-sizing: border-box !important;
      }
      
      /* Force layout recalculation for the entire viewport */
      html:has(#minerva-assistant-sidebar:not(.collapsed)),
      html.minerva-sidebar-active {
        overflow-x: hidden !important;
      }
      
      /* Ensure no horizontal scrolling */
      body:has(#minerva-assistant-sidebar:not(.collapsed)),
      body.minerva-sidebar-active {
        overflow-x: hidden !important;
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
      
      #minerva-assistant-sidebar .metric-value.decile {
        font-size: 11px !important;
        background: hsl(210 40% 96%) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        font-weight: 500 !important;
      }
      
      /* Percentile Color Coding */
      #minerva-assistant-sidebar .metric-value.percentile-red {
        color: var(--minerva-red) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.percentile-orange {
        color: var(--minerva-orange) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.percentile-green {
        color: var(--minerva-green) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.percentile-blue {
        color: var(--minerva-blue) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.percentile-purple {
        color: var(--minerva-purple) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.percentile-gray {
        color: var(--minerva-gray) !important;
        font-weight: 600 !important;
      }
      
      /* Suggested Score Color Coding (1-5 scale) */
      #minerva-assistant-sidebar .metric-value.score-1-red {
        color: var(--minerva-red) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.score-2-orange {
        color: var(--minerva-orange) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.score-3-green {
        color: var(--minerva-green) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.score-4-blue {
        color: var(--minerva-blue) !important;
        font-weight: 600 !important;
      }
      
      #minerva-assistant-sidebar .metric-value.score-5-purple {
        color: var(--minerva-purple) !important;
        font-weight: 600 !important;
      }
      
      /* Style the suggested score row differently */
      #minerva-assistant-sidebar .suggested-score-row {
        border-top: 1px solid hsl(214.3 31.8% 91.4%) !important;
        padding-top: 8px !important;
        margin-top: 8px !important;
      }

      /* Assignment Grader Styles */
      #minerva-assistant-sidebar .feedback-container {
        height: calc(100vh - 200px);
        overflow-y: auto;
        flex: 1;
      }
      
      /* Make the feedback section fill remaining space */
      #minerva-assistant-sidebar .sidebar-content {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 80px);
      }
      
      #minerva-assistant-sidebar .section:has(.feedback-container) {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      #minerva-assistant-sidebar .feedback-field {
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 16px;
        background: #f9fafb;
      }


      #minerva-assistant-sidebar .feedback-field textarea {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 8px;
        font-size: 14px;
        resize: vertical;
        min-height: 60px;
        font-family: inherit;
        box-sizing: border-box;
      }

      #minerva-assistant-sidebar .feedback-field textarea:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      #minerva-assistant-sidebar .feedback-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
        height: 27px;
      }

      #minerva-assistant-sidebar .feedback-title {
        font-weight: 600;
        color: #374151;
        font-size: 14px;
        margin: 0;
        line-height: 27px;
        min-width: 80px;
      }

      #minerva-assistant-sidebar .score-input {
        display: flex;
        align-items: center;
      }

      #minerva-assistant-sidebar .score-input input {
        width: 80px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0 12px;
        font-size: 14px;
        box-sizing: border-box;
        height: 27px;
        font-family: inherit;
        text-align: center;
        line-height: 25px;
      }

      #minerva-assistant-sidebar .score-input input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      /* Score-based container background colors */
      #minerva-assistant-sidebar .feedback-field.score-0 {
        background: #666666;
      }

      #minerva-assistant-sidebar .feedback-field.score-1 {
        background: #DB2F26;
      }

      #minerva-assistant-sidebar .feedback-field.score-2 {
        background: #EF8620;
      }

      #minerva-assistant-sidebar .feedback-field.score-3 {
        background: #31AA6E;
      }

      #minerva-assistant-sidebar .feedback-field.score-4 {
        background: #0B77BE;
      }

      #minerva-assistant-sidebar .feedback-field.score-5 {
        background: #5B3E97;
      }

      #minerva-assistant-sidebar .submit-individual-feedback {
        background: #3b82f6;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 0 16px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s;
        white-space: nowrap;
        height: 27px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 70px;
        line-height: 1;
      }

      #minerva-assistant-sidebar .submit-individual-feedback:hover {
        background: #2563eb;
      }

      #minerva-assistant-sidebar .submit-individual-feedback:active {
        transform: scale(0.98);
      }

      #minerva-assistant-sidebar .submit-individual-feedback:disabled,
      #minerva-assistant-sidebar .submit-individual-feedback.disabled {
        background: #9ca3af;
        color: #d1d5db;
        cursor: not-allowed;
        opacity: 0.6;
      }

      #minerva-assistant-sidebar .submit-individual-feedback:disabled:hover,
      #minerva-assistant-sidebar .submit-individual-feedback.disabled:hover {
        background: #9ca3af;
        transform: none;
      }

      #minerva-assistant-sidebar .add-feedback-section {
        text-align: center;
        padding: 16px 0;
      }

      #minerva-assistant-sidebar .add-feedback-section .btn {
        margin: 0;
      }

      #minerva-assistant-sidebar #learning-outcome {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        padding: 8px;
        font-size: 14px;
        font-family: inherit;
        box-sizing: border-box;
      }

      #minerva-assistant-sidebar #learning-outcome:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
      
      /* Copy feedback button in header */
      #minerva-assistant-sidebar .copy-feedback-btn {
        background: none !important;
        border: none !important;
        color: hsl(215.4 16.3% 46.9%) !important;
        font-size: 16px !important;
        cursor: pointer !important;
        padding: 4px !important;
        width: 28px !important;
        height: 28px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        border-radius: 4px !important;
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
        user-select: none !important;
      }
      
      #minerva-assistant-sidebar .copy-feedback-btn:hover {
        background: hsl(210 40% 96%) !important;
        color: hsl(222.2 84% 4.9%) !important;
      }
      
      #minerva-assistant-sidebar .copy-feedback-btn:active {
        transform: scale(0.95) !important;
        background: hsl(210 40% 94%) !important;
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
    } else if (pageName === 'assignment-grader') {
      this.setupAssignmentGraderEvents();
    }
  }

  getSidebarPageContent(pageName) {
    switch (pageName) {
      case 'grader':
        return this.getGraderPageContent();
      case 'analytics':
        return this.getAnalyticsPageContent();
      case 'assignment-grader':
        return this.getAssignmentGraderPageContent();
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

  getAssignmentGraderPageContent() {
    return `
      <div class="section">
        <div class="section-header">
          <h4>Learning Outcome</h4>
          <button id="clear-assignment-form" class="btn btn-small btn-secondary">Clear Form</button>
        </div>
        <input type="text" id="learning-outcome" placeholder="Enter HC/LO" />
        <small style="color: #666; font-size: 12px; display: block; margin-top: 4px;">
          With or without '#', e.g. #cp-navigation or cp-navigation
        </small>
      </div>
      
      <div class="section">
        <h4>Feedback & Scores</h4>
        <div class="feedback-container">
          ${this.generateFeedbackFields(5)}
          <div class="add-feedback-section">
            <button id="add-feedback-field" class="btn btn-secondary btn-small">Add More</button>
          </div>
        </div>
      </div>
    `;
  }

  generateFeedbackFields(count) {
    let fieldsHtml = '';
    for (let i = 1; i <= count; i++) {
      fieldsHtml += `
        <div class="feedback-field">
          <div class="feedback-header">
            <label class="feedback-title">Feedback ${i}</label>
            <div class="score-input">
              <input type="number" id="score-${i}" placeholder="Score" min="0" max="100" />
            </div>
            <button class="btn btn-small submit-individual-feedback" data-feedback-id="${i}">Insert</button>
          </div>
          <textarea id="feedback-${i}" placeholder="Enter feedback text..." rows="3"></textarea>
        </div>
      `;
    }
    return fieldsHtml;
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
        controls.innerHTML = `
          <button id="close-sidebar" class="close-btn" title="Close Sidebar">×</button>
        `;
        
        // Re-add event listener
        document.getElementById('close-sidebar').addEventListener('click', () => {
          this.closeSidebar();
        });
      }
    }
  }

  closeSidebar() {
    if (!this.sidebar) return;
    
    this.sidebar.classList.add('collapsed');
    
    // Restore page layout and remove sidebar completely
    setTimeout(() => {
      this.removeSidebarLayout();
      if (this.sidebar) {
        this.sidebar.remove();
        this.sidebar = null;
      }
    }, 300); // Wait for transition to complete
    
  }

  setupAssignmentGraderEvents() {
    // Initialize feedback field counter
    this.feedbackFieldCount = 5;
    
    // Set up event listeners for existing fields
    this.setupFeedbackFieldListeners();

    // Add more feedback fields button
    const addBtn = document.getElementById('add-feedback-field');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.addFeedbackField();
      });
    }

    // Clear form button
    const clearBtn = document.getElementById('clear-assignment-form');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearAssignmentForm();
      });
    }
  }

  setupFeedbackFieldListeners() {
    // Individual submit buttons
    const individualSubmitBtns = document.querySelectorAll('.submit-individual-feedback');
    individualSubmitBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const feedbackId = e.target.getAttribute('data-feedback-id');
        this.submitIndividualFeedback(feedbackId);
      });
    });

    // Score input change listeners for dynamic styling and button state
    const scoreInputs = document.querySelectorAll('[id^="score-"]');
    scoreInputs.forEach(scoreInput => {
      if (scoreInput && !scoreInput.hasAttribute('data-listener-added')) {
        scoreInput.addEventListener('input', (e) => {
          this.updateScoreInputStyling(e.target);
          this.updateSubmitButtonState(e.target);
        });
        scoreInput.addEventListener('change', (e) => {
          this.updateScoreInputStyling(e.target);
          this.updateSubmitButtonState(e.target);
        });
        scoreInput.setAttribute('data-listener-added', 'true');
      }
    });

    // Learning outcome change listener for button states
    const learningOutcomeInput = document.getElementById('learning-outcome');
    if (learningOutcomeInput && !learningOutcomeInput.hasAttribute('data-listener-added')) {
      learningOutcomeInput.addEventListener('input', () => {
        this.updateAllSubmitButtonStates();
      });
      learningOutcomeInput.addEventListener('change', () => {
        this.updateAllSubmitButtonStates();
      });
      learningOutcomeInput.setAttribute('data-listener-added', 'true');
    }

    // Initial button state check
    this.updateAllSubmitButtonStates();
  }

  addFeedbackField() {
    this.feedbackFieldCount++;
    const newFieldHtml = `
      <div class="feedback-field">
        <div class="feedback-header">
          <label class="feedback-title">Feedback ${this.feedbackFieldCount}</label>
          <div class="score-input">
            <input type="number" id="score-${this.feedbackFieldCount}" placeholder="Score" min="0" max="100" />
          </div>
          <button class="btn btn-small submit-individual-feedback" data-feedback-id="${this.feedbackFieldCount}">Insert</button>
        </div>
        <textarea id="feedback-${this.feedbackFieldCount}" placeholder="Enter feedback text..." rows="3"></textarea>
      </div>
    `;
    
    // Insert before the add button section
    const addSection = document.querySelector('.add-feedback-section');
    if (addSection) {
      addSection.insertAdjacentHTML('beforebegin', newFieldHtml);
      
      // Set up listeners for the new field
      this.setupFeedbackFieldListeners();
    }
  }

  updateScoreInputStyling(scoreInput) {
    const value = parseInt(scoreInput.value);
    
    // Find the parent feedback field container
    const feedbackField = scoreInput.closest('.feedback-field');
    if (!feedbackField) return;
    
    // Remove all existing score classes from the container
    feedbackField.classList.remove('score-0', 'score-1', 'score-2', 'score-3', 'score-4', 'score-5');
    
    // Add appropriate class based on score to the container
    if (!isNaN(value) && value >= 0 && value <= 5) {
      feedbackField.classList.add(`score-${value}`);
    }
  }

  updateSubmitButtonState(scoreInput) {
    const feedbackId = scoreInput.id.replace('score-', '');
    const submitBtn = document.querySelector(`.submit-individual-feedback[data-feedback-id="${feedbackId}"]`);
    
    if (submitBtn) {
      const hasOutcome = document.getElementById('learning-outcome')?.value.trim() || false;
      const hasScore = scoreInput.value.trim() || false;
      
      // Enable button only if both outcome and score are filled
      if (hasOutcome && hasScore) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('disabled');
      } else {
        submitBtn.disabled = true;
        submitBtn.classList.add('disabled');
      }
    }
  }

  updateAllSubmitButtonStates() {
    const hasOutcome = document.getElementById('learning-outcome')?.value.trim() || false;
    
    // Update all submit buttons based on outcome and their respective scores
    const submitBtns = document.querySelectorAll('.submit-individual-feedback');
    submitBtns.forEach(btn => {
      const feedbackId = btn.getAttribute('data-feedback-id');
      const scoreInput = document.getElementById(`score-${feedbackId}`);
      const hasScore = scoreInput?.value.trim() || false;
      
      // Enable button only if both outcome and score are filled
      if (hasOutcome && hasScore) {
        btn.disabled = false;
        btn.classList.remove('disabled');
      } else {
        btn.disabled = true;
        btn.classList.add('disabled');
      }
    });
  }

  submitAssignmentFeedback() {
    try {
      // Get learning outcome
      const learningOutcome = document.getElementById('learning-outcome')?.value || '';
      
      // Collect all feedback and scores (dynamic count)
      const feedbackData = [];
      const feedbackFields = document.querySelectorAll('[id^="feedback-"]');
      
      feedbackFields.forEach((feedbackField) => {
        const fieldId = feedbackField.id.replace('feedback-', '');
        const scoreField = document.getElementById(`score-${fieldId}`);
        
        const feedback = feedbackField.value || '';
        const score = scoreField?.value || '';
        
        if (feedback || score.trim()) {
          feedbackData.push({ feedback: feedback, score: score.trim() });
        }
      });

      if (!learningOutcome.trim() && feedbackData.length === 0) {
        alert('Please enter a learning outcome or at least one feedback item.');
        return;
      }

      // Find the add comment button on the page
      const addCommentBtn = document.querySelector('button.button-classroom-primary.add-comment');
      if (!addCommentBtn) {
        alert('Could not find the add comment button on the page. Make sure you are on the assignment grader page.');
        return;
      }

      // Click the add comment button to open the comment interface
      addCommentBtn.click();

      // Wait a moment for the interface to load, then populate fields
      setTimeout(() => {
        this.populateAssignmentFields(learningOutcome, feedbackData);
      }, 500);

    } catch (error) {
      console.error('Error submitting assignment feedback:', error);
      alert('Error submitting feedback. Please check the console for details.');
    }
  }

  submitIndividualFeedback(feedbackId) {
    try {
      // Get learning outcome
      const learningOutcome = document.getElementById('learning-outcome')?.value || '';
      
      // Get the specific feedback and score
      const feedback = document.getElementById(`feedback-${feedbackId}`)?.value || '';
      const score = document.getElementById(`score-${feedbackId}`)?.value || '';

      if (!feedback && !score.trim()) {
        alert(`Please enter feedback text or score for Feedback ${feedbackId}.`);
        return;
      }

      // Create feedback data array with just this item (preserve line breaks in feedback)
      const feedbackData = [{ feedback: feedback, score: score.trim() }];

      // Find the add comment button on the page
      const addCommentBtn = document.querySelector('button.button-classroom-primary.add-comment');
      if (!addCommentBtn) {
        alert('Could not find the add comment button on the page. Make sure you are on the assignment grader page.');
        return;
      }

      // Click the add comment button to open the comment interface
      addCommentBtn.click();

      // Wait a moment for the interface to load, then populate fields
      setTimeout(() => {
        this.populateAssignmentFields(learningOutcome, feedbackData);
      }, 500);

    } catch (error) {
      console.error('Error submitting individual feedback:', error);
      alert('Error submitting feedback. Please check the console for details.');
    }
  }

  populateAssignmentFields(learningOutcome, feedbackData) {
    try {
      // Minimal wait for modal to load, then do everything immediately
      setTimeout(() => {
        this.doPopulateFieldsFast(learningOutcome, feedbackData);
      }, 100);
      
    } catch (error) {
      console.error('Error populating assignment fields:', error);
      alert('Error populating fields. The comment interface may have changed.');
    }
  }

  async doPopulateFieldsFast(learningOutcome, feedbackData) {
    try {
      // Step 1: Populate comment immediately (independent of outcome)
      this.populateComment(feedbackData);
      
      // Step 2: Populate outcome and wait for grade field
      if (learningOutcome) {
        const outcomePopulated = await this.populateOutcomeFast(learningOutcome);
        if (outcomePopulated) {
          // Step 3: Wait for grade field to appear with polling
          await this.waitForGradeField(feedbackData);
        }
      }
      
    } catch (error) {
      console.error('Error in doPopulateFieldsFast:', error);
      alert('Error populating fields. Please check the console for details.');
    }
  }

  doPopulateFields(learningOutcome, feedbackData) {
    try {
      let populated = false;

      // Step 1: Handle Learning Outcome first (required to make grade field appear)
      if (learningOutcome) {
        this.populateOutcome(learningOutcome).then(outcomePopulated => {
          if (outcomePopulated) {
            populated = true;
            
            // Step 2: Wait for grade field to appear, then populate comment and try to set grade
            setTimeout(() => {
              this.populateCommentAndGrade(feedbackData);
            }, 1000); // Wait for grade field to appear after outcome selection
          }
        });
      } else {
        // No outcome, just populate comment
        this.populateCommentAndGrade(feedbackData);
      }
      
    } catch (error) {
      console.error('Error in doPopulateFields:', error);
      alert('Error populating fields. Please check the console for details.');
    }
  }

  async populateOutcome(learningOutcome) {
    try {
      // Try multiple selectors for the outcome field (excluding our own extension fields)
      const possibleSelectors = [
        'select#select-outcome', // The actual Minerva outcome selector
        'input[placeholder*="Choose an outcome"]',
        'select[name*="outcome"]',
        'input[placeholder*="Choose"]:not(#learning-outcome)', // Exclude our own field
        'input[type="text"]:not(#learning-outcome):not([id^="feedback-"]):not([id^="score-"])', // Exclude extension fields
        '.outcome-input',
        '#outcome',
        '[data-testid*="outcome"]',
        'select:not([id^="minerva-assistant"])' // Any select not from our extension
      ];
      
      let outcomeField = null;
      for (const selector of possibleSelectors) {
        const elements = document.querySelectorAll(selector);
        
        if (elements.length > 0) {
          // Use the first element found
          outcomeField = elements[0];
          break;
        }
      }
      
      if (outcomeField) {
        // Remove # if present in learning outcome
        const cleanOutcome = learningOutcome.replace(/^#/, '');
        
        // Handle both input and select elements
        if (outcomeField.tagName === 'SELECT') {
          // For select elements, try to find matching option
          const options = Array.from(outcomeField.options);
          
          // Try multiple matching strategies
          let matchingOption = null;
          
          // Strategy 1: Exact match
          matchingOption = options.find(option => 
            option.value === cleanOutcome ||
            option.text === cleanOutcome
          );
          
          if (!matchingOption) {
            // Strategy 2: Contains match (case insensitive)
            matchingOption = options.find(option => 
              option.value.toLowerCase().includes(cleanOutcome.toLowerCase()) ||
              option.text.toLowerCase().includes(cleanOutcome.toLowerCase())
            );
          }
          
          if (!matchingOption) {
            // Strategy 3: Partial match with common prefixes
            const commonPrefixes = ['cp-', '#cp-', 'outcome-', '#'];
            for (const prefix of commonPrefixes) {
              const withPrefix = prefix + cleanOutcome;
              const withoutPrefix = cleanOutcome.replace(prefix, '');
              
              matchingOption = options.find(option => 
                option.value.toLowerCase().includes(withPrefix.toLowerCase()) ||
                option.text.toLowerCase().includes(withPrefix.toLowerCase()) ||
                option.value.toLowerCase().includes(withoutPrefix.toLowerCase()) ||
                option.text.toLowerCase().includes(withoutPrefix.toLowerCase())
              );
              
              if (matchingOption) break;
            }
          }
          
          if (matchingOption) {
            outcomeField.value = matchingOption.value;
          }
        } else {
          // For input elements
          outcomeField.value = cleanOutcome;
        }
        
        // Trigger events to make sure the interface updates
        outcomeField.focus();
        outcomeField.dispatchEvent(new Event('focus', { bubbles: true }));
        outcomeField.dispatchEvent(new Event('input', { bubbles: true }));
        outcomeField.dispatchEvent(new Event('change', { bubbles: true }));
        outcomeField.dispatchEvent(new Event('blur', { bubbles: true }));
        
        // Simulate typing for autocomplete fields
        if (outcomeField.tagName === 'INPUT') {
          for (let i = 0; i < cleanOutcome.length; i++) {
            setTimeout(() => {
              const char = cleanOutcome[i];
              const keyEvent = new KeyboardEvent('keydown', {
                key: char,
                bubbles: true,
                cancelable: true
              });
              outcomeField.dispatchEvent(keyEvent);
              outcomeField.dispatchEvent(new Event('input', { bubbles: true }));
            }, i * 50);
          }
        }
        
        // Simulate pressing Enter to confirm selection
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true
        });
        outcomeField.dispatchEvent(enterEvent);
        
        const enterUpEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true,
          cancelable: true
        });
        outcomeField.dispatchEvent(enterUpEvent);
        
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error populating outcome:', error);
      return false;
    }
  }

  populateCommentAndGrade(feedbackData) {
    try {
      let populated = false;

      // Handle Comment Text Area (excluding our extension textareas)
      const commentSelectors = [
        'textarea#comment', // The actual Minerva comment field
        'textarea[placeholder*="Use"]', // Based on screenshot: "Use [⌘ + enter] to submit"
        'textarea[placeholder*="submit"]:not([id^="feedback-"])', // Exclude our extension fields
        'textarea[placeholder*="comment"]:not([id^="feedback-"])', // Exclude our extension fields
        'textarea:not([id^="feedback-"]):not(#minerva-assistant-sidebar textarea)', // Fallback excluding our fields
        '.comment-textarea',
        '[data-testid*="comment"]'
      ];
      
      let commentTextArea = null;
      for (const selector of commentSelectors) {
        commentTextArea = document.querySelector(selector);
        if (commentTextArea) {
          break;
        }
      }
      
      if (commentTextArea) {
        // Build the feedback text (without scores - they should be set via grade field)
        let feedbackText = '';
        
        feedbackData.forEach((item, index) => {
          if (item.feedback) {
            feedbackText += item.feedback;
            feedbackText += '\n\n';
          }
        });
        
        // Set the comment text (preserve leading line breaks)
        commentTextArea.value = feedbackText.replace(/\n\n$/, ''); // Only remove trailing double newlines
        commentTextArea.dispatchEvent(new Event('input', { bubbles: true }));
        commentTextArea.dispatchEvent(new Event('change', { bubbles: true }));
        commentTextArea.dispatchEvent(new Event('keyup', { bubbles: true }));
        populated = true;
      }

      // Try to populate grade field (should be visible after outcome selection)
      const firstScore = feedbackData.find(item => item.score);
      if (firstScore && firstScore.score) {
        setTimeout(() => {
          this.populateGradeField(firstScore.score);
        }, 500);
      }
      
    } catch (error) {
      console.error('Error populating comment and grade:', error);
    }
  }

  populateGradeField(score) {
    try {
      // Look for grade/score input field that should appear after outcome selection (excluding our extension fields)
      const gradeSelectors = [
        'select#select-score', // The actual Minerva grade selector
        'input[type="number"]:not([id^="score-"]):not(#learning-outcome)', // Exclude our extension score fields
        'input[name*="grade"]',
        'input[name*="score"]:not([id^="score-"])', // Exclude our extension fields
        'input[placeholder*="grade"]',
        'input[placeholder*="score"]:not([id^="score-"])', // Exclude our extension fields
        'input[placeholder*="0"]:not([id^="score-"])', // Sometimes grade fields have "0" placeholder
        'input[placeholder*="5"]:not([id^="score-"])', // Or "0-5" range indicators
        '.grade-input',
        '#grade',
        '#score',
        'input[min]:not([id^="score-"])', // Number inputs often have min attribute
        'input[max]:not([id^="score-"])', // Number inputs often have max attribute
        'select:not([id^="minerva-assistant"])' // Any select not from our extension
      ];
      
      let gradeField = null;
      for (const selector of gradeSelectors) {
        const elements = document.querySelectorAll(selector);
        
        if (elements.length > 0) {
          gradeField = elements[0];
          break;
        }
      }
      
      if (gradeField) {
        if (gradeField.tagName === 'SELECT') {
          const options = Array.from(gradeField.options);
          
          // Find option that matches the score
          const matchingOption = options.find(option => 
            option.value === score.toString() ||
            option.text === score.toString() ||
            option.value.includes(score.toString()) ||
            option.text.includes(score.toString())
          );
          
          if (matchingOption) {
            gradeField.value = matchingOption.value;
          }
        } else {
          gradeField.value = score;
        }
        
        gradeField.focus();
        gradeField.dispatchEvent(new Event('focus', { bubbles: true }));
        gradeField.dispatchEvent(new Event('input', { bubbles: true }));
        gradeField.dispatchEvent(new Event('change', { bubbles: true }));
        gradeField.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      } else {
        // Fallback to keyboard shortcut method
        const commentTextArea = document.querySelector('textarea');
        if (commentTextArea) {
          this.simulateScoreKeypress(commentTextArea, score);
        }
        return false;
      }
    } catch (error) {
      console.error('Error populating grade field:', error);
      return false;
    }
  }

  simulateScoreKeypress(element, score) {
    try {
      // Simulate the keyboard shortcut ⌘ + <score>
      const event = new KeyboardEvent('keydown', {
        key: score.toString(),
        code: `Digit${score}`,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: true, // ⌘ key on Mac (Cmd)
        bubbles: true,
        cancelable: true
      });
      
      element.focus();
      element.dispatchEvent(event);
      
      // Also try with Ctrl key for Windows users
      setTimeout(() => {
        const ctrlEvent = new KeyboardEvent('keydown', {
          key: score.toString(),
          code: `Digit${score}`,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          bubbles: true,
          cancelable: true
        });
        element.dispatchEvent(ctrlEvent);
      }, 100);
      
    } catch (error) {
      console.error('Error simulating score keypress:', error);
    }
  }

  async populateOutcomeFast(learningOutcome) {
    try {
      const outcomeField = document.querySelector('select#select-outcome');
      if (!outcomeField) {
        return false;
      }
      
      const cleanOutcome = learningOutcome.replace(/^#/, '');
      const options = Array.from(outcomeField.options);
      
      // Extract and match only the first word after '#' in each option
      let matchingOption = null;
      
      // Helper function to extract the outcome code from option text
      const extractOutcomeCode = (text) => {
        // Look for pattern like "#cp-something" or "#something" and extract just that part
        const match = text.match(/#([a-zA-Z0-9-]+)/);
        return match ? match[1].toLowerCase() : text.toLowerCase();
      };
      
      // Prepare the search term (with and without cp- prefix)
      const searchTerm = cleanOutcome.toLowerCase();
      const searchTermWithCp = `cp-${searchTerm}`;
      
      // Find option by matching only the outcome code (first word after #)
      matchingOption = options.find(option => {
        const optionCode = extractOutcomeCode(option.text || option.value);
        
        return optionCode === searchTerm || 
               optionCode === searchTermWithCp ||
               (optionCode.startsWith('cp-') && optionCode.replace('cp-', '') === searchTerm);
      });
      
      if (matchingOption) {
        // Set the value
        outcomeField.value = matchingOption.value;
        
        // Handle Select2 components
        if (window.jQuery && window.jQuery(outcomeField).data('select2')) {
          window.jQuery(outcomeField).val(matchingOption.value).trigger('change');
        } else {
          // Standard select element events
          outcomeField.dispatchEvent(new Event('change', { bubbles: true }));
          outcomeField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Additional events
        outcomeField.dispatchEvent(new Event('blur', { bubbles: true }));
        outcomeField.focus();
        
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error in populateOutcomeFast:', error);
      return false;
    }
  }

  populateComment(feedbackData) {
    try {
      const commentField = document.querySelector('textarea#comment');
      if (!commentField) {
        return false;
      }
      
      // Build feedback text (preserve line breaks)
      let feedbackText = '';
      feedbackData.forEach((item) => {
        if (item.feedback) {
          feedbackText += item.feedback + '\n\n';
        }
      });
      
      // Don't trim the entire text to preserve leading line breaks
      commentField.value = feedbackText.replace(/\n\n$/, ''); // Only remove trailing double newlines
      commentField.dispatchEvent(new Event('input', { bubbles: true }));
      commentField.dispatchEvent(new Event('change', { bubbles: true }));
      
      return true;
    } catch (error) {
      console.error('Error populating comment:', error);
      return false;
    }
  }

  async waitForGradeField(feedbackData) {
    try {
      const firstScore = feedbackData.find(item => item.score);
      if (!firstScore || !firstScore.score) {
        return;
      }
      
      // Poll for grade field with faster timeout
      let attempts = 0;
      const maxAttempts = 15; // 750ms max
      
      const pollForGradeField = () => {
        return new Promise((resolve) => {
          const checkField = () => {
            attempts++;
            const gradeField = document.querySelector('select#select-score');
            
            if (gradeField && gradeField.options.length > 1) {
              resolve(gradeField);
            } else if (attempts >= maxAttempts) {
              resolve(null);
            } else {
              setTimeout(checkField, 50); // Check every 50ms instead of 100ms
            }
          };
          checkField();
        });
      };
      
      const gradeField = await pollForGradeField();
      
      if (gradeField) {
        this.populateGradeFieldFast(gradeField, firstScore.score);
      }
      
    } catch (error) {
      console.error('Error waiting for grade field:', error);
    }
  }

  populateGradeFieldFast(gradeField, score) {
    try {
      const options = Array.from(gradeField.options);
      
      // Try multiple matching strategies for different grade systems
      const matchingOption = options.find(option => 
        option.value === score.toString() ||
        option.text === score.toString() ||
        option.innerHTML === score.toString() ||
        // Handle different grade formats
        option.text.includes(score.toString()) ||
        option.innerHTML.includes(score.toString()) ||
        // Handle letter grades if score maps to letters
        (score === 5 && (option.text.toLowerCase().includes('a') || option.text.toLowerCase().includes('excellent'))) ||
        (score === 4 && (option.text.toLowerCase().includes('b') || option.text.toLowerCase().includes('good'))) ||
        (score === 3 && (option.text.toLowerCase().includes('c') || option.text.toLowerCase().includes('satisfactory'))) ||
        (score === 2 && (option.text.toLowerCase().includes('d') || option.text.toLowerCase().includes('needs work'))) ||
        (score === 1 && (option.text.toLowerCase().includes('f') || option.text.toLowerCase().includes('poor'))) ||
        (score === 0 && (option.text.toLowerCase().includes('f') || option.text.toLowerCase().includes('fail')))
      );
      
      if (matchingOption) {
        // Set the value
        gradeField.value = matchingOption.value;
        
        // Handle Select2 components (common in web apps)
        if (window.jQuery && window.jQuery(gradeField).data('select2')) {
          window.jQuery(gradeField).val(matchingOption.value).trigger('change');
        } else {
          // Standard select element events
          gradeField.dispatchEvent(new Event('change', { bubbles: true }));
          gradeField.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Additional events that might be needed
        gradeField.dispatchEvent(new Event('blur', { bubbles: true }));
        gradeField.dispatchEvent(new Event('focus', { bubbles: true }));
        
        // Force a visual update by focusing and blurring
        gradeField.focus();
        gradeField.blur();
      }
    } catch (error) {
      console.error('Error in populateGradeFieldFast:', error);
    }
  }

  clearAssignmentForm() {
    // Clear learning outcome
    const learningOutcome = document.getElementById('learning-outcome');
    if (learningOutcome) learningOutcome.value = '';
    
    // Clear all feedback and score fields (dynamic count)
    const feedbackFields = document.querySelectorAll('[id^="feedback-"]');
    const scoreFields = document.querySelectorAll('[id^="score-"]');
    
    feedbackFields.forEach(field => {
      field.value = '';
      // Remove score styling from parent container
      const container = field.closest('.feedback-field');
      if (container) {
        container.classList.remove('score-0', 'score-1', 'score-2', 'score-3', 'score-4', 'score-5');
      }
    });
    
    scoreFields.forEach(field => {
      field.value = '';
      // Also remove score styling when clearing score fields
      const container = field.closest('.feedback-field');
      if (container) {
        container.classList.remove('score-0', 'score-1', 'score-2', 'score-3', 'score-4', 'score-5');
      }
    });
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
    
    // Use event delegation for copy feedback buttons (since they're dynamically created)
    const studentAnalytics = document.getElementById('student-analytics');
    if (studentAnalytics) {
      studentAnalytics.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-feedback-btn')) {
          this.copyStudentFeedback(e.target);
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

    // Calculate decile rankings for talk time, breakout time, and hand raises
    const talkTimeDeciles = this.calculateDeciles(students, 'talk-time');
    const breakoutDeciles = this.calculateDeciles(students, 'breakout-talk-time');
    const handRaiseDeciles = this.calculateDeciles(students, 'hand-raises');

    // Sort students alphabetically by first name
    const sortedStudents = students.sort((a, b) => {
      const nameA = (a.user?.['first-name'] || a.user?.firstName || 'Unknown').toLowerCase();
      const nameB = (b.user?.['first-name'] || b.user?.firstName || 'Unknown').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    let html = '<div class="student-cards">';
    
    sortedStudents.forEach(student => {
      const engagementScore = this.calculateEngagementScore(student);
      const talkTime = student['talk-time'] || student.talkTime || {};
      const breakoutTalkTime = student['breakout-talk-time'] || student.breakoutTalkTime || {};
      
      const talkSeconds = talkTime['duration-seconds'] || talkTime.durationSeconds || 0;
      const breakoutSeconds = breakoutTalkTime['duration-seconds'] || breakoutTalkTime.durationSeconds || 0;
      
      const talkDecile = talkTimeDeciles[student.user?.id] || 'N/A';
      const breakoutDecile = breakoutDeciles[student.user?.id] || 'N/A';
      const handRaiseDecile = handRaiseDeciles[student.user?.id] || 'N/A';
      
      // Get color classes based on percentile ranges
      const talkColorClass = this.getPercentileColorClass(talkDecile);
      const breakoutColorClass = this.getPercentileColorClass(breakoutDecile);
      const handRaiseColorClass = this.getPercentileColorClass(handRaiseDecile);
      
      // Calculate suggested score from average of all percentiles
      const suggestedScore = this.calculateSuggestedScore(student, talkDecile, breakoutDecile, handRaiseDecile);
      const scoreColorClass = this.getScoreColorClass(suggestedScore);
      
      html += `
        <div class="student-card">
          <div class="student-header">
            <div class="student-name">${student.user?.['first-name'] || student.user?.firstName || 'Unknown'} ${student.user?.['last-name'] || student.user?.lastName || ''}</div>
            <button class="copy-feedback-btn" data-student-id="${student.user?.id}" data-student-name="${student.user?.['first-name'] || student.user?.firstName || 'Unknown'} ${student.user?.['last-name'] || student.user?.lastName || ''}" data-talk-time="${talkSeconds}" data-talk-percentile="${talkDecile}" data-breakout-time="${breakoutSeconds}" data-breakout-percentile="${breakoutDecile}" data-hand-raises="${student['hand-raises'] || student.handRaises || 0}" data-hand-raise-percentile="${handRaiseDecile}" title="Copy feedback for ${student.user?.['first-name'] || student.user?.firstName || 'Unknown'}">
              📋
            </button>
          </div>
          
          <div class="student-metrics">
            <div class="metric-row">
              <span class="metric-label">Talk Time (percentile):</span>
              <span class="metric-value ${talkColorClass}">${talkSeconds}s (${talkDecile})</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Breakout Talk (percentile):</span>
              <span class="metric-value ${breakoutColorClass}">${breakoutSeconds}s (${breakoutDecile})</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Focus:</span>
              <span class="metric-value">${Math.round(student['window-focus-percentage'] || student.windowFocusPercentage || 0)}%</span>
            </div>
            
            <div class="metric-row">
              <span class="metric-label">Hand Raises (percentile):</span>
              <span class="metric-value ${handRaiseColorClass}">${student['hand-raises'] || student.handRaises || 0} (${handRaiseDecile})</span>
            </div>
            
            <div class="metric-row suggested-score-row">
              <span class="metric-label">Average score:</span>
              <span class="metric-value ${scoreColorClass}">${suggestedScore}</span>
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    studentAnalytics.innerHTML = html;
    
    // Re-setup event listeners for the newly created buttons
    this.setupCopyButtonListeners();
  }

  setupCopyButtonListeners() {
    // Add event listeners to all copy feedback buttons
    document.querySelectorAll('.copy-feedback-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Copy button clicked!');
        this.copyStudentFeedback(e.target);
      });
    });
  }

  calculateDeciles(students, metricType) {
    // Extract values for all students based on metric type
    const values = students.map(student => {
      let value = 0;
      
      if (metricType === 'hand-raises') {
        value = student['hand-raises'] || student.handRaises || 0;
      } else {
        // For talk-time and breakout-talk-time
        const timeData = student[metricType] || student[metricType.replace('-', '')] || {};
        value = timeData['duration-seconds'] || timeData.durationSeconds || 0;
      }
      
      return {
        id: student.user?.id,
        value: value
      };
    }).filter(item => item.id); // Only include students with valid IDs

    // Sort by values (ascending)
    values.sort((a, b) => a.value - b.value);

    // Calculate decile boundaries
    const decileMap = {};
    const totalStudents = values.length;

    values.forEach((item, index) => {
      // Calculate which decile this student is in (1-10)
      const percentile = (index + 1) / totalStudents;
      let decile;
      
      if (percentile <= 0.1) decile = '0-10%';
      else if (percentile <= 0.2) decile = '10-20%';
      else if (percentile <= 0.3) decile = '20-30%';
      else if (percentile <= 0.4) decile = '30-40%';
      else if (percentile <= 0.5) decile = '40-50%';
      else if (percentile <= 0.6) decile = '50-60%';
      else if (percentile <= 0.7) decile = '60-70%';
      else if (percentile <= 0.8) decile = '70-80%';
      else if (percentile <= 0.9) decile = '80-90%';
      else decile = '90-100%';

      decileMap[item.id] = decile;
    });

    return decileMap;
  }

  calculateEngagementScore(student) {
    // Calculate a composite engagement score from various metrics
    let score = 0;
    
    // Focus percentage (10% weight)
    const focusPercentage = student['window-focus-percentage'] || student.windowFocusPercentage || 0;
    score += focusPercentage * 0.1;
    
    // Talk time status (35% weight)
    const talkTime = student['talk-time'] || student.talkTime || {};
    const talkTimeScore = this.getStatusScore(talkTime.status);
    score += talkTimeScore * 30 * 0.35;
    
    // Breakout talk time status (35% weight)
    const breakoutTalkTime = student['breakout-talk-time'] || student.breakoutTalkTime || {};
    const breakoutScore = this.getStatusScore(breakoutTalkTime.status);
    score += breakoutScore * 30 * 0.35;
    
    // Activity metrics (20% weight) - only hand raises
    const handRaises = student['hand-raises'] || student.handRaises || 0;
    
    const activityScore = Math.min(100, handRaises * 5);
    score += activityScore * 0.2;
    
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

  getPercentileColorClass(percentileRange) {
    // Extract the lower bound of the percentile range
    if (percentileRange === 'N/A') return 'percentile-gray';
    
    const match = percentileRange.match(/^(\d+)-/);
    if (!match) return 'percentile-gray';
    
    const lowerBound = parseInt(match[1]);
    
    if (lowerBound >= 90) return 'percentile-purple';  // 90-100%
    if (lowerBound >= 70) return 'percentile-blue';    // 70-90%
    if (lowerBound >= 50) return 'percentile-green';   // 50-70%
    if (lowerBound >= 20) return 'percentile-orange';  // 20-50%
    return 'percentile-red';                           // 0-20%
  }

  calculateSuggestedScore(student, talkDecile, breakoutDecile, handRaiseDecile) {
    // Convert percentile ranges to numeric values for averaging
    const talkPercentile = this.extractPercentileValue(talkDecile);
    const breakoutPercentile = this.extractPercentileValue(breakoutDecile);
    const handRaisePercentile = this.extractPercentileValue(handRaiseDecile);
    const focusPercentile = student['window-focus-percentage'] || student.windowFocusPercentage || 0;
    
    // Calculate average across all four categories
    const validPercentiles = [talkPercentile, breakoutPercentile, handRaisePercentile, focusPercentile].filter(p => p !== null);
    
    if (validPercentiles.length === 0) return 1;
    
    const averagePercentile = validPercentiles.reduce((sum, p) => sum + p, 0) / validPercentiles.length;
    
    // Convert average percentile to 1-5 score
    if (averagePercentile >= 90) return 5;
    if (averagePercentile >= 70) return 4;
    if (averagePercentile >= 50) return 3;
    if (averagePercentile >= 20) return 2;
    return 1;
  }

  extractPercentileValue(percentileRange) {
    // Extract the midpoint of the percentile range for averaging
    if (percentileRange === 'N/A') return null;
    
    const match = percentileRange.match(/^(\d+)-(\d+)%/);
    if (!match) return null;
    
    const lowerBound = parseInt(match[1]);
    const upperBound = parseInt(match[2]);
    return (lowerBound + upperBound) / 2;
  }

  getScoreColorClass(score) {
    switch(score) {
      case 1: return 'score-1-red';
      case 2: return 'score-2-orange';
      case 3: return 'score-3-green';
      case 4: return 'score-4-blue';
      case 5: return 'score-5-purple';
      default: return 'percentile-gray';
    }
  }

  copyStudentFeedback(button) {
    // Get student data from button attributes
    const studentName = button.getAttribute('data-student-name');
    const talkTime = button.getAttribute('data-talk-time');
    const talkPercentile = button.getAttribute('data-talk-percentile');
    const breakoutTime = button.getAttribute('data-breakout-time');
    const breakoutPercentile = button.getAttribute('data-breakout-percentile');
    const handRaises = button.getAttribute('data-hand-raises');
    const handRaisePercentile = button.getAttribute('data-hand-raise-percentile');
    
    // Debug logging
    console.log('Copy button data:', {
      studentName, talkTime, talkPercentile, breakoutTime, breakoutPercentile, handRaises, handRaisePercentile
    });
    
    // Create the feedback message
    const feedbackText = `Thanks for your class participation. We listened to the comments you made in the class and used the following metrics to calculate your class engagement.

Talk Time: ${talkTime || 'N/A'}s (${talkPercentile || 'N/A'} percentile)
Breakout Talk Time: ${breakoutTime || 'N/A'}s (${breakoutPercentile || 'N/A'} percentile)  
Hand Raises: ${handRaises || 'N/A'} (${handRaisePercentile || 'N/A'} percentile)`;

    console.log('Feedback text to copy:', feedbackText);

    // Copy to clipboard
    navigator.clipboard.writeText(feedbackText).then(() => {
      this.showNotification(`Feedback copied for ${studentName || 'student'}`, 'success');
    }).catch(err => {
      console.error('Failed to copy feedback:', err);
      this.showNotification('Failed to copy feedback', 'error');
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
    // Don't update if sidebar doesn't exist yet
    if (!this.sidebar) {
      console.log('Sidebar not created yet - skipping update');
      return;
    }
    
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
           this.ensureSidebarExists();
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_GRADER':
           this.ensureSidebarExists();
           this.loadSidebarPage('grader');
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_UNAVAILABLE':
           this.ensureSidebarExists();
           this.loadSidebarPage('unavailable');
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_ANALYTICS':
           this.ensureSidebarExists();
           this.loadSidebarPage('analytics', request.classId);
           this.sidebar.classList.remove('collapsed');
           break;
         case 'SHOW_ASSIGNMENT_GRADER':
           this.ensureSidebarExists();
           this.loadSidebarPage('assignment-grader');
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
