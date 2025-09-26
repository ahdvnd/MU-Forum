# Quick Installation Guide

## Prerequisites
- Google Chrome browser
- OpenAI API key (get one from https://platform.openai.com/api-keys)
- Access to forum.minerva.edu

## Installation Steps

### 1. Load the Extension
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `MU-Forum` folder containing the extension files

### 2. Verify Installation
- You should see the "Minerva Forum Assistant" extension in your extensions list
- The extension icon should appear in your Chrome toolbar

### 3. Initial Setup
1. **Navigate to Minerva Forum**: Go to `https://forum.minerva.edu/` and log in
2. **Click the extension icon** in your toolbar to open the popup menu
3. **Configure API Key**: Click "Configure Settings" and enter your OpenAI API key
4. **Show the sidebar**: Click "Show Sidebar" to access the full interface

### 4. Set Up Your First Rubric
1. In the sidebar, find the "Rubric" section
2. Either:
   - Type your grading rubric directly into the text area
   - Paste a link to a public Google Sheets document with your rubric
3. Click "Save Rubric"

### 5. Start Using the Assistant
1. Navigate to pages with student poll responses or assignments
2. Click the extension icon and then "Show Sidebar" to open the assistant
3. The extension will automatically detect and capture student responses
4. Click "Analyze All Responses" to get AI-powered grading assistance
5. Review the scores, comments, and suggestions provided
6. Close the sidebar when finished using any of these methods:
   - Click the × button in the sidebar header
   - Click the "Close Sidebar" button at the bottom
   - Press the Escape key

## Troubleshooting

### Extension Not Loading
- Make sure all files are in the same folder
- Check that Developer mode is enabled
- Try reloading the extension from chrome://extensions/

### Not Detecting Responses
- Ensure you're on forum.minerva.edu
- Try refreshing the page
- Check that there are active polls or assignments on the page

### API Key Issues
- Verify your OpenAI API key is correct
- Make sure your OpenAI account has sufficient credits
- Check that the key has the necessary permissions

## File Structure
Your extension folder should contain:
```
MU-Forum/
├── manifest.json
├── background.js
├── content.js
├── sidebar.css
├── popup.html
├── popup.js
├── icons/
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
├── README.md
└── INSTALL.md
```

## Next Steps
- See README.md for detailed usage instructions
- Configure your rubrics for different assignments
- Explore the engagement metrics features

## Support
If you encounter issues:
1. Check the Chrome Developer Console for error messages
2. Verify all files are present and correctly named
3. Ensure you have the latest version of Chrome
4. Try disabling other extensions that might conflict
