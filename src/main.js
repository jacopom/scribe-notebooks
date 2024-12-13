const { app, BrowserWindow, session } = require('electron');
const Store = require('electron-store');
const path = require('path');

const store = new Store();

// Set dock icon for macOS
if (process.platform === 'darwin') {
  app.dock.setIcon(path.join(__dirname, '../build/icon.png'));
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false  // Required for Amazon's authentication
    },
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    frame: true,
    icon: path.join(__dirname, '../build/icon.png')
  });

  // Set Android user agent and modify headers
  const userAgent = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = userAgent;
    details.requestHeaders['Sec-Fetch-Site'] = 'none';
    details.requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    details.requestHeaders['Sec-Fetch-Dest'] = 'document';
    callback({ requestHeaders: details.requestHeaders });
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders;
    // Remove restrictive headers
    delete responseHeaders['X-Frame-Options'];
    delete responseHeaders['Content-Security-Policy'];
    callback({
      responseHeaders: {
        ...responseHeaders,
        'Access-Control-Allow-Origin': ['*']
      }
    });
  });

  // Load the URL directly instead of using a webview
  mainWindow.loadURL('https://read.amazon.com/kindle-notebook');

  // Optional: Enable DevTools for debugging
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
}); 