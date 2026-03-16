const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu } = require('electron');
const path = require('node:path');

app.setPath('userData', path.join(app.getPath('appData'), 'scribe-notebooks'));

const HOME_URL = 'https://read.amazon.com/kindle-notebook?ref_=neo_mm_yn_na_kfa';
const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const TOOLBAR_HEIGHT = 44;

function isLoginUrl(url) {
  return /\/(ap\/|signin|login|auth)|account\.amazon|\/gp\/sign-in/i.test(url || '');
}

function setupSession(sess) {
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = UA_MOBILE;
    details.requestHeaders['Sec-Fetch-Site'] = 'none';
    details.requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    details.requestHeaders['Sec-Fetch-Dest'] = 'document';
    callback({ requestHeaders: details.requestHeaders });
  });

  sess.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    headers['access-control-allow-origin'] = ['*'];
    callback({ responseHeaders: headers });
  });
}

// Open a standard browser popup for login, then copy the session back
function openLoginWindow(contentView) {
  const loginWin = new BrowserWindow({
    width: 460,
    height: 680,
    title: 'Sign in to Amazon',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Share the SAME session so cookies persist automatically
      session: contentView.webContents.session,
    },
  });

  loginWin.loadURL('https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.com%2Fkindle-notebook&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kindle_mykindle_us&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0');

  // Auto-close popup once login lands back on read.amazon.com
  function onNavigate(_, url) {
    if (url.includes('read.amazon.com') && !isLoginUrl(url)) {
      loginWin.close();
    }
  }
  loginWin.webContents.on('did-navigate', onNavigate);
  loginWin.webContents.on('did-navigate-in-page', onNavigate);

  // Always reload the main view when the popup closes — session cookies are
  // shared, so whatever Amazon the user authenticated against is already live.
  loginWin.on('closed', () => {
    contentView.webContents.loadURL(HOME_URL);
  });
}

function buildMenu(contentView) {
  const template = [
    {
      label: 'Scribe Notebook',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Sign in…',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => openLoginWindow(contentView),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const contentView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'content-preload.js'),
    },
  });

  win.contentView.addChildView(contentView);
  setupSession(contentView.webContents.session);
  contentView.webContents.setUserAgent(UA_MOBILE);

  buildMenu(contentView);

  // Show welcome page when Amazon redirects to login
  contentView.webContents.on('did-navigate', (_, url) => {
    if (isLoginUrl(url)) {
      contentView.webContents.loadFile(path.join(__dirname, 'renderer', 'welcome.html'));
    }
  });

  ipcMain.handle('open-login', () => openLoginWindow(contentView));

  function resizeContentView() {
    const [width, height] = win.getContentSize();
    contentView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: height - TOOLBAR_HEIGHT });
  }

  win.on('resize', resizeContentView);

  win.once('ready-to-show', () => {
    win.show();
    resizeContentView();
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  contentView.webContents.loadURL(HOME_URL);

  const nav = contentView.webContents.navigationHistory;

  ipcMain.handle('nav:back', () => nav.goBack());
  ipcMain.handle('nav:forward', () => nav.goForward());
  ipcMain.handle('nav:reload', () => contentView.webContents.reload());
  ipcMain.handle('nav:home', () => contentView.webContents.loadURL(HOME_URL));

  function sendNavState() {
    if (win.isDestroyed()) return;
    win.webContents.send('nav-state', {
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
    });
  }

  contentView.webContents.on('did-navigate', sendNavState);
  contentView.webContents.on('did-navigate-in-page', sendNavState);

  contentView.webContents.on('did-start-loading', () => {
    if (!win.isDestroyed()) win.webContents.send('loading', true);
  });

  contentView.webContents.on('did-stop-loading', () => {
    if (!win.isDestroyed()) win.webContents.send('loading', false);
    sendNavState();
  });

  win.on('closed', () => {
    ipcMain.removeHandler('open-login');
    ipcMain.removeHandler('nav:back');
    ipcMain.removeHandler('nav:forward');
    ipcMain.removeHandler('nav:reload');
    ipcMain.removeHandler('nav:home');
  });
}

app.whenReady().then(() => {
  setupSession(session.defaultSession);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
