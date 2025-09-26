# Minerva Forum Assistant

A Chrome extension that provides AI-powered grading assistance for instructors using the Minerva Forum LMS.

## Features

- **AI-Powered Grading**: Compare student responses against custom rubrics using OpenAI's API
- **Rubric Management**: Input rubrics manually or import from Google Sheets
- **Real-time Analysis**: Intercept and analyze student poll responses automatically
- **Engagement Metrics**: Track student participation and response quality
- **Sidebar Interface**: Seamless integration with the Minerva Forum interface
- **Local Data Storage**: All data and API keys stored securely on your device

## Installation

1. **Clone or download this repository**
2. **Open Chrome and navigate to** `chrome://extensions/`
3. **Enable Developer mode** (toggle in the top right)
4. **Click "Load unpacked"** and select the extension folder
5. **Navigate to** `https://forum.minerva.edu/` and log in
6. **Click the extension icon** to open the popup and configure your settings

## Setup

### 1. Configure OpenAI API Key
- Click the extension icon in your browser toolbar
- Click "Configure Settings" 
- Enter your OpenAI API key (get one from https://platform.openai.com/api-keys)
- Your API key is stored locally and never shared

### 2. Set Up a Rubric
- Open the assistant sidebar on any Minerva Forum page
- In the "Rubric" section, either:
  - Type your rubric directly into the text area
  - Paste a link to a public Google Sheets document containing your rubric
- Click "Save Rubric"

### 3. Start Grading
- Navigate to pages with student poll responses
- The extension will automatically detect and capture response data
- Click "Analyze All Responses" to get AI-powered feedback
- Review scores, comments, and suggestions for each student

## How It Works

### API Interception
The extension intercepts API calls made by the Minerva Forum to capture student response data in real-time. This works by:
- Monitoring network requests to forum.minerva.edu/api/*
- Extracting poll responses and student data from JSON responses
- Processing and storing data locally for analysis

### AI Analysis
When you analyze responses, the extension:
1. Sends the rubric and student responses to OpenAI's API
2. Receives structured feedback including scores, comments, and suggestions
3. Displays results in an easy-to-read format in the sidebar

### Data Privacy
- All student data is processed locally and never transmitted except to OpenAI for analysis
- Your OpenAI API key is stored securely in Chrome's local storage
- No data is sent to external servers other than OpenAI's API

## Usage Tips

### Rubric Best Practices
- Be specific about grading criteria and point values
- Include examples of excellent, good, and poor responses
- Use clear language that the AI can understand and apply

### Google Sheets Integration
- Make sure your Google Sheet is publicly accessible (share with "Anyone with the link can view")
- Structure your rubric clearly with headers and criteria
- The extension will convert the sheet to text format for AI analysis

### Engagement Metrics
- The sidebar shows basic metrics like response count and average length
- More advanced metrics can be added based on the data available in the forum's API

## Troubleshooting

### Extension Not Working
- Make sure you're on `forum.minerva.edu`
- Check that the extension is enabled in Chrome
- Try refreshing the page and reopening the sidebar

### API Key Issues
- Verify your OpenAI API key is correct
- Check that your OpenAI account has sufficient credits
- Make sure the API key has the necessary permissions

### No Student Responses Detected
- Navigate to pages with active polls or assignments
- Check the browser's network tab to see if API calls are being made
- Try interacting with polls to trigger API requests

### Google Sheets Not Loading
- Ensure the sheet is publicly accessible
- Check that the URL is a valid Google Sheets link
- Try copying the sheet content directly into the text area instead

## Development

### File Structure
```
MU-Forum/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for API interception
├── content.js            # Content script for sidebar and UI
├── sidebar.css           # Styling for the sidebar interface
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── icons/                # Extension icons
└── README.md             # This file
```

### Key Components
- **Background Script**: Handles API interception and OpenAI communication
- **Content Script**: Manages the sidebar UI and user interactions
- **Popup**: Provides quick status and settings access
- **CSS**: Responsive styling for all UI components

## Privacy & Security

This extension:
- ✅ Stores all data locally on your device
- ✅ Only sends data to OpenAI's API for analysis (with your explicit consent)
- ✅ Uses secure Chrome storage APIs for sensitive data
- ✅ Does not track or collect any personal information
- ✅ Does not transmit data to any servers except OpenAI

## License

This project is for educational use with the Minerva Forum LMS. Please ensure compliance with your institution's policies and OpenAI's terms of service.

## Support

For issues or feature requests, please check:
1. This README for troubleshooting tips
2. Your OpenAI API key configuration
3. Chrome extension permissions
4. Network connectivity to forum.minerva.edu

## Version History

- **v1.0.0**: Initial release with AI grading, rubric management, and sidebar interface
