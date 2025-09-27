// Popup script for Minerva Forum Assistant
class MinervaPopup {
  constructor() {
    this.init();
  }

  async init() {
    await this.loadStatus();
    this.setupEventListeners();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
  }

  async loadStatus() {
    try {
      // Get current tab info
      const tabs = await this.getCurrentTab();
      const currentTab = tabs[0];
      
      // Check if we're on Minerva Forum
      const isMinervaForum = currentTab.url.includes('forum.minerva.edu');
      document.getElementById('page-status').textContent = isMinervaForum ? 'Minerva Forum' : 'Other Site';
      document.getElementById('page-status').className = `status-value ${isMinervaForum ? 'success' : 'warning'}`;

      // Parse and display course/section/class info if on Minerva Forum
      if (isMinervaForum) {
        this.displayCourseInfo(currentTab.url);
      }

      // Get settings
      const settings = await this.getSettings();
      
      // Update API key status
      const hasApiKey = settings.openaiApiKey && settings.openaiApiKey.length > 0;
      document.getElementById('api-key-status').textContent = hasApiKey ? 'Configured' : 'Not Set';
      document.getElementById('api-key-status').className = `status-value ${hasApiKey ? 'success' : 'error'}`;

      // Update rubric status
      const hasRubric = settings.rubric && settings.rubric.length > 0;
      document.getElementById('rubric-status').textContent = hasRubric ? 'Set' : 'Not Set';
      document.getElementById('rubric-status').className = `status-value ${hasRubric ? 'success' : 'warning'}`;

      // Content script communication removed - stats section removed

      // Show warnings/messages
      this.showMessages(isMinervaForum, hasApiKey, hasRubric);

    } catch (error) {
      console.error('Error loading status:', error);
      this.showError('Failed to load extension status');
    }
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

  displayCourseInfo(url) {
    const courseInfo = this.parseMinervaUrl(url);
    const courseInfoCard = document.getElementById('course-info-card');
    
    // Only show the card if we found at least a course ID
    if (courseInfo.courseId) {
      courseInfoCard.style.display = 'block';
      
      // Update course ID
      document.getElementById('course-id').textContent = courseInfo.courseId;
      document.getElementById('course-id').className = 'status-value success';
      
      // Update section ID
      if (courseInfo.sectionId) {
        document.getElementById('section-id').textContent = courseInfo.sectionId;
        document.getElementById('section-id').className = 'status-value success';
      } else {
        document.getElementById('section-id').textContent = 'Not Available';
        document.getElementById('section-id').className = 'status-value warning';
      }
      
      // Update class ID
      if (courseInfo.classId) {
        document.getElementById('class-id').textContent = courseInfo.classId;
        document.getElementById('class-id').className = 'status-value success';
      } else {
        document.getElementById('class-id').textContent = 'Not Available';
        document.getElementById('class-id').className = 'status-value warning';
      }
    } else {
      // Hide the card if no course info found
      courseInfoCard.style.display = 'none';
    }
  }

  showMessages(isMinervaForum, hasApiKey, hasRubric) {
    const warningContainer = document.getElementById('warning-container');
    const successContainer = document.getElementById('success-container');
    
    warningContainer.innerHTML = '';
    successContainer.innerHTML = '';

    if (!isMinervaForum) {
      warningContainer.innerHTML = `
        <div class="warning-message">
          This extension works on forum.minerva.edu. Please navigate to the Minerva Forum to use the assistant.
        </div>
      `;
    } else if (!hasApiKey) {
      warningContainer.innerHTML = `
        <div class="warning-message">
          Please configure your OpenAI API key to enable AI-powered grading assistance.
        </div>
      `;
    } else if (!hasRubric) {
      warningContainer.innerHTML = `
        <div class="warning-message">
          Please set up a rubric in the sidebar to start analyzing student responses.
        </div>
      `;
    } else {
      successContainer.innerHTML = `
        <div class="success-message">
          Extension is ready! Click "Show Sidebar" to start grading with AI assistance.
        </div>
      `;
    }
  }

  setupEventListeners() {
    document.getElementById('show-sidebar').addEventListener('click', () => {
      this.showSidebar();
    });

    document.getElementById('configure-settings').addEventListener('click', () => {
      this.configureSettings();
    });

    document.getElementById('refresh-data').addEventListener('click', () => {
      this.refreshData();
    });
  }

  async showSidebar() {
    try {
      const tabs = await this.getCurrentTab();
      const currentTab = tabs[0];
      
      if (!currentTab.url.includes('forum.minerva.edu')) {
        this.showError('Please navigate to forum.minerva.edu first');
        // Close popup after a brief delay to show the error
        setTimeout(() => window.close(), 2000);
        return;
      }

      // Disable button and show loading state
      const button = document.getElementById('show-sidebar');
      button.textContent = 'Opening...';
      button.disabled = true;

      // Send message to show sidebar and close popup immediately
      this.sendMessageToTab(currentTab.id, { type: 'SHOW_SIDEBAR' }).catch(err => {
        console.log('Message send failed, but closing popup anyway:', err);
      });
      
      // Close popup immediately after sending message
      window.close();
    } catch (error) {
      console.error('Error showing sidebar:', error);
      this.showError('Failed to show sidebar');
      // Close popup after a brief delay to show the error
      setTimeout(() => window.close(), 2000);
    }
  }

  async configureSettings() {
    try {
      const tabs = await this.getCurrentTab();
      const currentTab = tabs[0];
      
      if (!currentTab.url.includes('forum.minerva.edu')) {
        this.showError('Please navigate to forum.minerva.edu first');
        // Close popup after a brief delay to show the error
        setTimeout(() => window.close(), 2000);
        return;
      }

      // Disable button and show loading state
      const button = document.getElementById('configure-settings');
      button.textContent = 'Opening...';
      button.disabled = true;

      // Send message to open settings and close popup immediately
      this.sendMessageToTab(currentTab.id, { type: 'OPEN_SETTINGS' }).catch(err => {
        console.log('Message send failed, but closing popup anyway:', err);
      });
      
      // Close popup immediately after sending message
      window.close();
    } catch (error) {
      console.error('Error opening settings:', error);
      this.showError('Failed to open settings');
      // Close popup after a brief delay to show the error
      setTimeout(() => window.close(), 2000);
    }
  }

  async refreshData() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    
    try {
      const tabs = await this.getCurrentTab();
      const currentTab = tabs[0];
      
      if (currentTab.url.includes('forum.minerva.edu')) {
        await this.sendMessageToTab(currentTab.id, { type: 'REFRESH_DATA' });
      }
      
      await this.loadStatus();
    } catch (error) {
      console.error('Error refreshing data:', error);
      this.showError('Failed to refresh data');
    }
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
  }

  showError(message) {
    const warningContainer = document.getElementById('warning-container');
    warningContainer.innerHTML = `
      <div class="warning-message">
        ${message}
      </div>
    `;
  }

  // Helper methods
  getCurrentTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, resolve);
    });
  }

  sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  }

  getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['minervaSettings'], (result) => {
        resolve(result.minervaSettings || {});
      });
    });
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new MinervaPopup();
});
