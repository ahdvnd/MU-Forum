// Background service worker for Minerva Forum Assistant
class MinervaForumAssistant {
  constructor() {
    this.apiData = new Map();
    this.setupEventListeners();
    this.encryptionKey = null;
  }

  // Generate a simple encryption key based on browser/extension context
  async getEncryptionKey() {
    if (this.encryptionKey) return this.encryptionKey;
    
    // Use a combination of extension ID and a fixed salt for consistency
    const extensionId = chrome.runtime.id;
    const salt = 'minerva-assistant-v1.2.7';
    const keyMaterial = extensionId + salt;
    
    // Create a simple hash-based key (not cryptographically secure but better than plain text)
    this.encryptionKey = await this.simpleHash(keyMaterial);
    return this.encryptionKey;
  }

  // Simple hash function for basic obfuscation
  async simpleHash(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.slice(0, 16); // Use first 16 bytes as key
  }

  // Simple XOR encryption/decryption
  async encryptData(plaintext) {
    if (!plaintext) return plaintext;
    
    const key = await this.getEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    
    const encrypted = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      encrypted[i] = data[i] ^ key[i % key.length];
    }
    
    // Convert to base64 for storage
    return btoa(String.fromCharCode(...encrypted));
  }

  async decryptData(encryptedData) {
    if (!encryptedData) return encryptedData;
    
    try {
      const key = await this.getEncryptionKey();
      
      // Convert from base64
      const encrypted = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));
      
      const decrypted = new Uint8Array(encrypted.length);
      for (let i = 0; i < encrypted.length; i++) {
        decrypted[i] = encrypted[i] ^ key[i % key.length];
      }
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }

  setupEventListeners() {
    // Listen for web requests to intercept API calls - very specific to avoid conflicts
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.handleApiRequest(details),
      {
        urls: [
          "https://forum.minerva.edu/api/*",
          "https://forum.minerva.edu/app/api/*"
        ],
        types: ["xmlhttprequest"]
      },
      ["requestBody"]
    );

    // Listen for responses to capture data
    chrome.webRequest.onCompleted.addListener(
      (details) => this.handleApiResponse(details),
      {
        urls: [
          "https://forum.minerva.edu/api/*", 
          "https://forum.minerva.edu/app/api/*"
        ],
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
      case 'PING':
        sendResponse({ success: true });
        break;
        
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
              content: `You are an AI grading assistant. Given the question and the model answer, the student response and the rubric please grade on the scale of 1-5 and provide feedback.

              Here are the information:
              Question: ${data.questionText || 'Not provided'}
              Model Answer: ${data.expectedAnswer || 'Not provided'}
              Student response: ${data.studentResponse}
              Rubric: ${data.rubric}

              Don't use 5 generously and only use it for answers that are mindblowing. I expect most grades to be in the 2-3 range with exceptional 4's. If the grade is 4-5 give a positive encouragement one-liner. If the score is 3, provide a short explanation that acknowledges the student's answer was good but was missing a point and mention the point. If the student's grade is 2-3, provide feedback on what they got wrong and what the correct answer is. In all cases, make sure your feedback is 1-3 sentences (so it should be very concise) unless you need to explain in more detail why they got the answer wrong.

              Format your response as JSON with keys: score (1-5), comments (your concise feedback)`
            },
            {
              role: 'user',
              content: `Please grade this student response according to the instructions above.`
            }
          ],
          temperature: 0.3,
          max_tokens: 500
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
          comments: content
        };
      }
    } catch (error) {
      console.error('OpenAI Analysis Error:', error);
      return {
        error: error.message,
        score: null,
        comments: 'Analysis failed. Please check your API key and try again.'
      };
    }
  }

  async saveSettings(settings) {
    return new Promise(async (resolve) => {
      try {
        // First get existing settings, then merge with new settings
        chrome.storage.local.get(['minervaSettings'], async (result) => {
          const existingSettings = await this.decryptSettings(result.minervaSettings || {});
          const mergedSettings = { ...existingSettings, ...settings };
          
          console.log('Saving settings (API key will be encrypted)');
          
          // Encrypt sensitive data before storing
          const encryptedSettings = await this.encryptSettings(mergedSettings);
          
          chrome.storage.local.set({ minervaSettings: encryptedSettings }, () => {
            console.log('Settings saved successfully with encryption');
            resolve();
          });
        });
      } catch (error) {
        console.error('Error saving settings:', error);
        resolve();
      }
    });
  }

  async getSettings() {
    return new Promise(async (resolve) => {
      try {
        chrome.storage.local.get(['minervaSettings'], async (result) => {
          const encryptedSettings = result.minervaSettings || {};
          const decryptedSettings = await this.decryptSettings(encryptedSettings);
          resolve(decryptedSettings);
        });
      } catch (error) {
        console.error('Error loading settings:', error);
        resolve({});
      }
    });
  }

  // Encrypt sensitive settings
  async encryptSettings(settings) {
    const encrypted = { ...settings };
    
    // Only encrypt the API key, leave other settings as plain text
    if (settings.openaiApiKey) {
      encrypted.openaiApiKey = await this.encryptData(settings.openaiApiKey);
      encrypted._encrypted = true; // Flag to indicate encryption is used
    }
    
    return encrypted;
  }

  // Decrypt sensitive settings
  async decryptSettings(settings) {
    if (!settings._encrypted) {
      // Handle legacy unencrypted settings
      return settings;
    }
    
    const decrypted = { ...settings };
    
    if (settings.openaiApiKey) {
      decrypted.openaiApiKey = await this.decryptData(settings.openaiApiKey);
    }
    
    // Remove the encryption flag from the returned object
    delete decrypted._encrypted;
    
    return decrypted;
  }
}

// Initialize the assistant
new MinervaForumAssistant();
