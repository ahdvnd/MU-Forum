# Security Information

## API Key Storage Security

### Current Implementation (v1.2.7+)
- **Encryption**: OpenAI API keys are encrypted using XOR cipher with a browser-specific key
- **Local Storage**: Keys are stored in Chrome's extension storage (isolated from websites)
- **No Transmission**: Keys are only sent directly to OpenAI's API, never to other servers

### Security Measures
1. **Basic Encryption**: API keys are XOR-encrypted before storage
2. **Browser Isolation**: Chrome extension storage is separate from website storage
3. **Extension-Only Access**: Only this extension can access its stored data
4. **Automatic Decryption**: Keys are decrypted only when needed for API calls

### Remaining Risks
- **Physical Access**: Someone with access to your computer could potentially extract the key
- **Malicious Extensions**: Other extensions with storage permissions could theoretically access data
- **XSS in Extension**: If this extension had XSS vulnerabilities (it doesn't), keys could be exposed

### Best Practices for Users
1. **Use Restricted API Keys**: Create API keys with minimal required permissions in OpenAI dashboard
2. **Regular Rotation**: Rotate your API keys periodically
3. **Monitor Usage**: Check your OpenAI usage dashboard for unexpected activity
4. **Revoke if Needed**: You can revoke the API key anytime from your OpenAI account

### For Maximum Security
If you need maximum security, consider:
- Using environment variables instead of browser storage
- Implementing a proxy server that handles API calls
- Using OAuth-based authentication instead of API keys

### Technical Details
- Encryption: XOR cipher with SHA-256 derived key
- Storage: Chrome extension local storage
- Key Derivation: Based on extension ID + salt
- Backward Compatibility: Handles both encrypted and legacy unencrypted keys

## Reporting Security Issues
If you discover a security vulnerability, please report it responsibly by creating a GitHub issue or contacting the maintainer directly.
