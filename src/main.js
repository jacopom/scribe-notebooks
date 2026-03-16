const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.setPath('userData', path.join(app.getPath('appData'), 'scribe-notebooks'));

// Detect and crop black borders on the left/right by sampling rows in the
// middle of the image. Only rows where black exists on BOTH sides are used,
// which avoids full-width header/footer bars throwing off the scan.
function cropBlackBorders(img) {
  const { width, height } = img.getSize();
  const bitmap = img.toBitmap();

  const rowStart = Math.floor(height * 0.3);
  const rowEnd   = Math.floor(height * 0.7);
  const step     = Math.max(1, Math.floor((rowEnd - rowStart) / 20));

  let bestL = 0, bestR = width;
  for (let row = rowStart; row < rowEnd; row += step) {
    let l = 0, r = width;
    // Look for the bright notebook paper (all channels > 150), not just "non-black"
    // The dark gray UI bands are rgb(99,99,99) which would fool a >30 threshold
    for (let x = 0; x < width; x++) {
      const i = (row * width + x) * 4;
      if (bitmap[i] > 150 && bitmap[i + 1] > 150 && bitmap[i + 2] > 150) { l = x; break; }
    }
    for (let x = width - 1; x >= 0; x--) {
      const i = (row * width + x) * 4;
      if (bitmap[i] > 150 && bitmap[i + 1] > 150 && bitmap[i + 2] > 150) { r = x + 1; break; }
    }
    // Only trust rows that have black on BOTH sides (l > 0 AND r < width)
    if (l > 0 && r < width) {
      if (l > bestL) bestL = l; // tightest left crop
      if (r < bestR) bestR = r; // tightest right crop
    }
  }

  if (bestL >= bestR) return { jpeg: img.toJPEG(92), w: width, h: height };

  const cropped = (bestL > 0 || bestR < width)
    ? img.crop({ x: bestL, y: 0, width: bestR - bestL, height })
    : img;
  const { width: w, height: h } = cropped.getSize();
  return { jpeg: cropped.toJPEG(92), w, h };
}

// Build a minimal multi-page PDF from an array of JPEG captures.
// Each entry: { jpeg: Buffer, w: number, h: number } (physical pixels).
// Object layout per page i: 3+i*3 = page, 4+i*3 = content stream, 5+i*3 = image
function buildPDF(pages) {
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;

  function pushObj(buf) {
    offsets.push(pos);
    parts.push(buf);
    pos += buf.length;
  }

  const n = pages.length;
  const pageIds    = pages.map((_, i) => 3 + i * 3);
  const contentIds = pages.map((_, i) => 4 + i * 3);
  const imgIds     = pages.map((_, i) => 5 + i * 3);

  // Obj 1: Catalog
  pushObj(Buffer.from(`1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`));
  // Obj 2: Pages
  pushObj(Buffer.from(`2 0 obj\n<</Type/Pages/Kids[${pageIds.map(id => `${id} 0 R`).join(' ')}]/Count ${n}>>\nendobj\n`));

  for (let i = 0; i < n; i++) {
    const { jpeg, w, h } = pages[i];
    const stream = `q ${w} 0 0 ${h} 0 0 cm /I Do Q`;

    // Page object
    pushObj(Buffer.from(
      `${pageIds[i]} 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]` +
      `/Contents ${contentIds[i]} 0 R/Resources<</XObject<</I ${imgIds[i]} 0 R>>>>>>\nendobj\n`
    ));
    // Content stream
    pushObj(Buffer.from(
      `${contentIds[i]} 0 obj\n<</Length ${stream.length}>>\nstream\n${stream}\nendstream\nendobj\n`
    ));
    // Image XObject (binary — concat header + jpeg + footer)
    pushObj(Buffer.concat([
      Buffer.from(
        `${imgIds[i]} 0 obj\n<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}` +
        `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n`
      ),
      jpeg,
      Buffer.from('\nendstream\nendobj\n'),
    ]));
  }

  // xref + trailer — totalObjs = 1 (free) + 2 (catalog/pages) + n*3 (page+stream+img)
  const totalObjs = 3 + n * 3;
  const xrefOff = pos;
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += off.toString().padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<</Size ${totalObjs}/Root 1 0 R>>\nstartxref\n${xrefOff}\n%%EOF`;
  parts.push(Buffer.from(xref));

  return Buffer.concat(parts);
}

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

  ipcMain.handle('export:pdf', async () => {
    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Notebook as PDF',
      defaultPath: 'notebook.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!filePath) return { cancelled: true };

    // Scroll to top, then capture all pages by scrolling through the content
    await contentView.webContents.executeJavaScript(`window.scrollTo(0, 0)`);
    await new Promise(r => setTimeout(r, 300));

    const { scrollHeight, viewportHeight } = await contentView.webContents.executeJavaScript(`
      ({ scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight })
    `);

    // Capture each viewport-height chunk, auto-cropping black border strips
    const captures = [];
    for (let y = 0; y < scrollHeight; y += viewportHeight) {
      await contentView.webContents.executeJavaScript(`window.scrollTo(0, ${y})`);
      await new Promise(r => setTimeout(r, 250));
      const img = await contentView.webContents.capturePage();
      captures.push(cropBlackBorders(img)); // returns { jpeg, w, h }
    }

    // Restore scroll position
    await contentView.webContents.executeJavaScript(`window.scrollTo(0, 0)`);

    const pdf = buildPDF(captures);
    fs.writeFileSync(filePath, pdf);
    return { ok: true, filePath };
  });

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
    ipcMain.removeHandler('export:pdf');
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
