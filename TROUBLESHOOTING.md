# Troubleshooting Guide - Missing Close Button

## Issue: Close Button (×) Not Visible in Sidebar Header

If you don't see the close button (×) in the sidebar header, follow these steps:

### Step 1: Reload the Extension
1. Go to `chrome://extensions/`
2. Find "Minerva Forum Assistant"
3. Click the refresh/reload button (🔄) for the extension
4. Go back to forum.minerva.edu and try again

### Step 2: Clear Browser Cache
1. Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac) to hard refresh the page
2. Or go to Chrome Settings > Privacy and Security > Clear browsing data
3. Select "Cached images and files" and clear

### Step 3: Check Developer Console
1. On forum.minerva.edu, press `F12` to open Developer Tools
2. Go to the Console tab
3. Look for messages starting with "Close button found:" or "Minerva Assistant"
4. If you see "Close button found: NO", there's an issue with the sidebar creation

### Step 4: Manually Check Extension Files
Make sure your extension files are up to date:
- `manifest.json` should show version "1.0.1"
- `content.js` should contain the close button HTML: `<button id="close-sidebar" class="close-btn" title="Close Sidebar">×</button>`

### Step 5: Alternative Ways to Close Sidebar

Even if the × button is missing, you can still close the sidebar using:

1. **"Close Sidebar" button**: Scroll to the bottom of the sidebar and click the "Close Sidebar" button
2. **Escape key**: Press the `Esc` key on your keyboard
3. **Reload page**: Refresh the forum.minerva.edu page

### Step 6: Complete Reinstall (if needed)
If the issue persists:
1. Go to `chrome://extensions/`
2. Remove the "Minerva Forum Assistant" extension
3. Reload the extension folder using "Load unpacked"
4. Go to forum.minerva.edu and test again

### Debug Information

If you're still having issues, check the browser console for these messages:
- "Close button found: YES" - Button exists
- "Close button found: NO" - Button missing (extension will try to add it manually)
- "Close button HTML: ..." - Shows the actual button element

### Expected Behavior
- The sidebar header should show "Minerva Assistant" on the left
- On the right side of the header, there should be a circular × button
- Clicking the × button should slide the sidebar off-screen
- The × button should have a hover effect (background highlight)

### Contact Support
If none of these steps work, please:
1. Check the browser console for error messages
2. Note your Chrome version and operating system
3. Try the extension in an incognito window to rule out other extension conflicts
