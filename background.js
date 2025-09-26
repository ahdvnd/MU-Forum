// Background service worker for Minerva Forum Assistant
class MinervaForumAssistant {
  constructor() {
    this.apiData = new Map();
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for web requests to intercept API calls
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.handleApiRequest(details),
      {
        urls: ["https://forum.minerva.edu/api/*"],
        types: ["xmlhttprequest"]
      },
      ["requestBody"]
    );

    // Listen for responses to capture data
    chrome.webRequest.onCompleted.addListener(
      (details) => this.handleApiResponse(details),
      {
        urls: ["https://forum.minerva.edu/api/*"],
        types: ["xmlhttprequest"]
      },
      ["responseHeaders"]
    );

    // Handle messages from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  handleApiRequest(details) {
    // Store request details for later analysis
    this.apiData.set(details.requestId, {
      url: details.url,
      method: details.method,
      requestBody: details.requestBody,
      timestamp: Date.now(),
      type: 'request'
    });
  }

  handleApiResponse(details) {
    // Update stored data with response information
    const requestData = this.apiData.get(details.requestId);
    if (requestData) {
      requestData.statusCode = details.statusCode;
      requestData.responseHeaders = details.responseHeaders;
      requestData.type = 'complete';
      
      // Notify content script about new API data
      this.notifyContentScript(details.tabId, requestData);
    }
  }

  async notifyContentScript(tabId, apiData) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'API_DATA',
        data: apiData
      });
    } catch (error) {
      console.log('Content script not ready:', error);
    }
  }

  async handleMessage(request, sender, sendResponse) {
    switch (request.type) {
      case 'GET_API_DATA':
        sendResponse({ data: Array.from(this.apiData.values()) });
        break;
        
      case 'ANALYZE_WITH_AI':
        const result = await this.analyzeWithOpenAI(request.data);
        sendResponse({ result });
        break;
        
      case 'SAVE_SETTINGS':
        await this.saveSettings(request.settings);
        sendResponse({ success: true });
        break;
        
      case 'GET_SETTINGS':
        const settings = await this.getSettings();
        sendResponse({ settings });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  async analyzeWithOpenAI(data) {
    try {
      const settings = await this.getSettings();
      if (!settings.openaiApiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: `You are an AI assistant helping to grade student responses based on a rubric. 
              
              Rubric: ${data.rubric}
              
              Please analyze the student response and provide:
              1. A numerical score (0-100)
              2. Detailed comments explaining the score
              3. Specific suggestions for improvement
              
              Format your response as JSON with keys: score, comments, suggestions`
            },
            {
              role: 'user',
              content: `Student Response: ${data.studentResponse}`
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const result = await response.json();
      const content = result.choices[0].message.content;
      
      try {
        return JSON.parse(content);
      } catch (parseError) {
        // If JSON parsing fails, return structured response
        return {
          score: null,
          comments: content,
          suggestions: 'Please review the analysis above for detailed feedback.'
        };
      }
    } catch (error) {
      console.error('OpenAI Analysis Error:', error);
      return {
        error: error.message,
        score: null,
        comments: 'Analysis failed. Please check your API key and try again.',
        suggestions: ''
      };
    }
  }

  async saveSettings(settings) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ minervaSettings: settings }, resolve);
    });
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['minervaSettings'], (result) => {
        resolve(result.minervaSettings || {});
      });
    });
  }
}

// Initialize the assistant
new MinervaForumAssistant();
