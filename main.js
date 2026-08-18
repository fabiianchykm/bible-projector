const { app, BrowserWindow, ipcMain, screen, nativeTheme, dialog, shell, Menu } = require('electron');
const path = require('path');
const url = require('url');
const Database = require('better-sqlite3');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

let adminWindow;
let projectorWindow;
let db;
// Другий (паралельний) переклад
let secondaryDb;
let secondaryDbName = '';

// Шлях до файлу налаштувань у папці даних користувача
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

let projectorSettings = {
  backgroundColor: 'black', // Колір фону за замовчуванням
  backgroundImage: null, // Шлях до зображення
  showFullBookName: true, // Показувати повну назву книги над скороченням
  theme: 'system', // Тема інтерфейсу: 'system' | 'light' | 'dark'
  parallelMode: false, // Показувати два переклади одночасно
  secondaryTranslation: null, // Файл другого перекладу для паралельного показу
  categoryColors: {
    pentateuch: '#FFDDC1',
    historical: '#CCE5FF',
    poetic: '#D4EDDA',
    prophetic: '#FFF3CD',
    gospels: '#F8D7DA',
    acts: '#E2E3E5',
    epistles: '#D6D8EC',
    revelation: '#F0E68C'
  }
};

let currentDbName = '';

// --- Шляхи до перекладів ---
const userTranslationsPath = path.join(app.getPath('userData'), 'translations');
const bundledTranslationsPath = app.isPackaged
  ? path.join(process.resourcesPath, 'translations')
  : path.join(__dirname, 'translations');

// --- Налаштування логування для auto-updater ---
log.transports.file.level = 'info';
autoUpdater.logger = log;
log.info('App starting...');

// --- Управління налаштуваннями ---

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(projectorSettings, null, 2));
    console.log('[main] Налаштування збережено.');
  } catch (e) {
    console.error('[main] Не вдалося зберегти налаштування:', e);
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      // Глибоке об'єднання для categoryColors, щоб нові категорії з коду не зникали
      if (saved.categoryColors) {
        saved.categoryColors = { ...projectorSettings.categoryColors, ...saved.categoryColors };
      }
      projectorSettings = { ...projectorSettings, ...saved };
      console.log('[main] Налаштування завантажено.');
    }
  } catch (e) {
    console.error('[main] Не вдалося завантажити налаштування:', e);
  }
}

// --- Управління перекладами ---

// Отримує список всіх доступних перекладів (з bundled та user папок)
function getAllTranslations() {
  const translationFiles = new Set();

  // 1. Читаємо переклади користувача
  try {
    if (fs.existsSync(userTranslationsPath)) {
      fs.readdirSync(userTranslationsPath)
        .filter(file => file.toLowerCase().endsWith('.sqlite3') || file.toLowerCase().endsWith('.sqlite'))
        .forEach(file => translationFiles.add(file));
    }
  } catch (e) {
    console.error(`Не вдалося прочитати папку користувача з перекладами (${userTranslationsPath}):`, e.message);
  }

  // 2. Читаємо вбудовані переклади
  try {
    if (fs.existsSync(bundledTranslationsPath)) {
      fs.readdirSync(bundledTranslationsPath)
        .filter(file => file.toLowerCase().endsWith('.sqlite3') || file.toLowerCase().endsWith('.sqlite'))
        .forEach(file => translationFiles.add(file)); // Set автоматично обробляє дублікати
    }
  } catch (e) {
    console.error(`Не вдалося прочитати вбудовану папку з перекладами (${bundledTranslationsPath}):`, e.message);
  }

  return Array.from(translationFiles);
}

// --- Онлайн-каталог модулів перекладів ---

const MODULES_API_BASE = 'https://bible-api-itministy.web.app';

// Стандартна нумерація книг MyBible (66 книг), як у вбудованих перекладах.
// Індекс у масиві відповідає sort_order - 1 модуля з каталогу.
const MYBIBLE_BOOK_NUMBERS = [
  10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
  190, 220, 230, 240, 250, 260, 290, 300, 310, 330, 340, 350, 360, 370,
  380, 390, 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510,
  520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650,
  660, 670, 680, 690, 700, 710, 720, 730
];

// Відповідність модулів каталогу вбудованим перекладам, які вже їдуть з
// програмою — щоб той самий переклад не показувався як «можна скачати»
const BUNDLED_EQUIVALENTS = {
  'ukr-cuv23': "CUV'23.SQLite3",
  'ukr-filaret': 'FIL.SQLite3',
  'ukr-homenko': 'HOM.SQLite3',
  'rus-rstb': 'RSTB.SQLite3',
  'ukr-turkonyak': 'TUR.SQLite3',
  'ukr-ubd96': 'UBD96.SQLite3',
  'ukr-ubio62': "UBIO'62.SQLite3",
  'ukr-ubio88': "UBIO'88.SQLite3",
  'ukr-kulish': 'UKRK.SQLite3',
  'ukr-msc22': "МСЦ'22.SQLite3"
};

// Ім'я файлу, під яким модуль з каталогу зберігається у папці перекладів
// (назва файлу без розширення показується користувачу у списку перекладів)
function moduleFileName(mod) {
  const safe = String(mod.localName || mod.name || mod.id)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  return `${safe || mod.id}.sqlite`;
}

async function fetchModulesCatalog() {
  const res = await fetch(`${MODULES_API_BASE}/catalog.json`);
  if (!res.ok) throw new Error(`Сервер каталогу відповів з помилкою (HTTP ${res.status}).`);
  const catalog = await res.json();
  return catalog.modules || [];
}

// Конвертує модуль з каталогу (books.id/name/sort_order, verses.book_id)
// у формат MyBible, який використовує решта програми
// (books.book_number/short_name, verses.book_number)
function convertModuleToMyBible(sourcePath, targetPath) {
  const src = new Database(sourcePath, { readonly: true, fileMustExist: true });
  fs.rmSync(targetPath, { force: true });
  const dst = new Database(targetPath);
  try {
    dst.exec(`
      CREATE TABLE books (
        book_number NUMERIC NOT NULL,
        short_name TEXT NOT NULL,
        long_name TEXT NOT NULL,
        book_color TEXT NOT NULL DEFAULT '',
        sorting_order NUMERIC NOT NULL DEFAULT 0,
        PRIMARY KEY (book_number));
      CREATE TABLE verses (
        book_number NUMERIC NOT NULL,
        chapter NUMERIC NOT NULL,
        verse NUMERIC NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (book_number, chapter, verse));
    `);

    const books = src.prepare('SELECT id, name, long_name, sort_order FROM books ORDER BY sort_order').all();
    const bookNumberById = {};
    const insBook = dst.prepare(
      "INSERT INTO books (book_number, short_name, long_name, book_color, sorting_order) VALUES (?, ?, ?, '', ?)"
    );
    books.forEach((b, i) => {
      const num = MYBIBLE_BOOK_NUMBERS[b.sort_order - 1] ?? (b.sort_order * 10);
      bookNumberById[b.id] = num;
      insBook.run(num, b.name, b.long_name, i);
    });

    const insVerse = dst.prepare('INSERT INTO verses (book_number, chapter, verse, text) VALUES (?, ?, ?, ?)');
    const insertAll = dst.transaction(() => {
      for (const v of src.prepare('SELECT book_id, chapter, verse, text FROM verses').iterate()) {
        const num = bookNumberById[v.book_id];
        if (num !== undefined) insVerse.run(num, v.chapter, v.verse, v.text);
      }
    });
    insertAll();
  } catch (e) {
    dst.close();
    fs.rmSync(targetPath, { force: true }); // не залишаємо недороблений файл
    src.close();
    throw e;
  }
  src.close();
  dst.close();
}

// Список модулів каталогу з позначкою, які вже встановлені
ipcMain.handle('get-modules-catalog', async () => {
  const modules = await fetchModulesCatalog();
  const installed = new Set(getAllTranslations().map(f => f.toLowerCase()));
  return modules.map(m => {
    const bundledName = BUNDLED_EQUIVALENTS[m.id];
    return {
      id: m.id,
      name: m.name,
      localName: m.localName,
      language: m.language,
      sizeBytes: m.sizeBytes,
      fileName: moduleFileName(m),
      installed: installed.has(moduleFileName(m).toLowerCase())
        || (bundledName !== undefined && installed.has(bundledName.toLowerCase()))
    };
  });
});

// Завантажує модуль з каталогу, перевіряє суму та конвертує у папку перекладів
ipcMain.handle('download-module', async (event, moduleId) => {
  try {
    const modules = await fetchModulesCatalog();
    const mod = modules.find(m => m.id === moduleId);
    if (!mod) throw new Error(`Модуль "${moduleId}" не знайдено в каталозі.`);

    const fileRes = await fetch(`${MODULES_API_BASE}${mod.url}`);
    if (!fileRes.ok) throw new Error(`Не вдалося завантажити файл (HTTP ${fileRes.status}).`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    if (mod.sha256) {
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      if (hash !== mod.sha256) throw new Error('Контрольна сума файлу не збігається — спробуйте ще раз.');
    }

    if (!fs.existsSync(userTranslationsPath)) {
      fs.mkdirSync(userTranslationsPath, { recursive: true });
    }
    const tmpPath = path.join(userTranslationsPath, `.${mod.id}.download`);
    const targetPath = path.join(userTranslationsPath, moduleFileName(mod));
    fs.writeFileSync(tmpPath, buffer);
    try {
      convertModuleToMyBible(tmpPath, targetPath);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }

    log.info(`Module downloaded: ${mod.id} -> ${targetPath}`);
    return { success: true, fileName: moduleFileName(mod) };
  } catch (e) {
    log.error('download-module failed:', e);
    return { success: false, message: e.message || String(e) };
  }
});

// Знаходить повний шлях до файлу перекладу, надаючи пріоритет файлам користувача
function getTranslationDbPath(dbName) {
  const userPath = path.join(userTranslationsPath, dbName);
  if (fs.existsSync(userPath)) return userPath;

  const bundledPath = path.join(bundledTranslationsPath, dbName);
  if (fs.existsSync(bundledPath)) return bundledPath;

  return null; // Не знайдено
}

// Переконуємось, що директорія існує
try {
  if (!fs.existsSync(userTranslationsPath)) {
    fs.mkdirSync(userTranslationsPath, { recursive: true });
    console.log(`Створено директорію для перекладів користувача: ${userTranslationsPath}`);
  }
} catch (e) {
  console.error('Не вдалося створити директорію для перекладів:', e);
}

// Налаштовуємо назву застосунку та меню, щоб прибрати дефолтне «Electron»
function setupBranding() {
  app.setName('Bible Projector');

  // Панель «Про програму» (macOS) без згадок Electron
  app.setAboutPanelOptions({
    applicationName: 'Bible Projector',
    applicationVersion: app.getVersion(),
    version: '',
    copyright: '© Bible Projector'
  });

  if (process.platform === 'darwin') {
    // На macOS повністю прибрати меню не можна, тож робимо мінімальне власне.
    // Підменю «Редагувати» потрібне, щоб у полях вводу працювали Cmd+C/V/A.
    const template = [
      {
        label: 'Bible Projector',
        submenu: [
          { role: 'about', label: 'Про Bible Projector' },
          { type: 'separator' },
          { role: 'hide', label: 'Сховати' },
          { role: 'hideOthers', label: 'Сховати інші' },
          { role: 'unhide', label: 'Показати все' },
          { type: 'separator' },
          { role: 'quit', label: 'Вийти' }
        ]
      },
      {
        label: 'Редагувати',
        submenu: [
          { role: 'undo', label: 'Скасувати' },
          { role: 'redo', label: 'Повторити' },
          { type: 'separator' },
          { role: 'cut', label: 'Вирізати' },
          { role: 'copy', label: 'Копіювати' },
          { role: 'paste', label: 'Вставити' },
          { role: 'selectAll', label: 'Виділити все' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: прибираємо стандартне меню Electron повністю
    Menu.setApplicationMenu(null);
  }
}

// Функція для створення вікна адміністратора
function createAdminWindow() {
  const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  adminWindow = new BrowserWindow({
    width: 500,
    height: screenHeight,
    resizable: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  adminWindow.loadFile('admin.html');
  // adminWindow.webContents.openDevTools(); // Розкоментовано для налагодження

  // Обнуляємо змінну при закритті вікна
  adminWindow.on('closed', () => {
    adminWindow = null;
  });
}

// Функція для створення вікна проектора
function createProjectorWindow() {
  console.log('[main] Спроба створити вікно проектора...');
  // Шукаємо другий монітор, якщо він є
  const displays = screen.getAllDisplays();
  console.log('[main] Знайдено дисплеїв:', displays);
  const externalDisplay = displays.find(
    (display) => display.bounds.x !== 0 || display.bounds.y !== 0
  );
  console.log('[main] Зовнішній дисплей:', externalDisplay ? externalDisplay.bounds : 'Не знайдено');

  projectorWindow = new BrowserWindow({
    // Якщо є другий монітор, відкриваємо вікно на ньому
    // x: externalDisplay ? externalDisplay.bounds.x : undefined, // Тимчасово вимкнено для діагностики
    // y: externalDisplay ? externalDisplay.bounds.y : undefined, // Тимчасово вимкнено для діагностики
    width: 1024,
    height: 768,
    icon: path.join(__dirname, 'icon.png'), // Додаємо іконку для вікна
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  console.log('[main] Об\'єкт projectorWindow створено.');

  projectorWindow.loadFile('projector.html')
    .then(() => {
      // Створюємо об'єкт налаштувань для відправки, конвертуючи шлях у URL
      const settingsForRenderer = { ...projectorSettings };
      if (settingsForRenderer.backgroundImage) {
        settingsForRenderer.backgroundImage = url.format({
          pathname: settingsForRenderer.backgroundImage,
          protocol: 'file:',
          slashes: true
        });
      }
      // Після завантаження вікна, надсилаємо початкові налаштування
      if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.webContents.send('settings-updated', settingsForRenderer);
      }
    })
    .catch(err => {
      console.error('[main] Не вдалося завантажити projector.html:', err);
    });

  // projectorWindow.webContents.openDevTools(); // Тимчасово для налагодження
  // Розгортаємо вікно на весь екран і ховаємо меню
  if (externalDisplay) {
    projectorWindow.maximize();
  }
  projectorWindow.setMenuBarVisibility(false);

  // Обнуляємо змінну при закритті вікна
  projectorWindow.on('closed', () => {
    console.log('[main] Вікно проектора було закрито.');
    projectorWindow = null;
  });
}

// Запускаємо створення вікна, коли програма готова
app.whenReady().then(() => {
  // Прибираємо дефолтне меню Electron і ставимо власну назву
  setupBranding();

  // Завантажуємо збережені налаштування на старті
  loadSettings();
  applyThemeSetting(projectorSettings.theme);

  const translations = getAllTranslations();

  if (translations.length > 0) {
    // Підключаємось до першого знайденого перекладу за замовчуванням
    currentDbName = translations[0];
    const dbPath = getTranslationDbPath(currentDbName);
    if (dbPath) {
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        console.log(`Успішно підключено до бази даних за замовчуванням: ${currentDbName}`);
      } catch (err) {
        console.error(`Не вдалося підключитися до бази даних ${currentDbName}:`, err.message);
      }
    }

    // Відкриваємо другий переклад, якщо увімкнено паралельний режим
    if (projectorSettings.parallelMode && projectorSettings.secondaryTranslation) {
      const secondaryPath = getTranslationDbPath(projectorSettings.secondaryTranslation);
      if (secondaryPath) {
        try {
          secondaryDb = new Database(secondaryPath, { readonly: true, fileMustExist: true });
          secondaryDbName = projectorSettings.secondaryTranslation;
          console.log(`Успішно підключено до другого перекладу: ${secondaryDbName}`);
        } catch (err) {
          console.error(`Не вдалося підключитися до другого перекладу ${projectorSettings.secondaryTranslation}:`, err.message);
        }
      }
    }

    if (!dbPath) {
      console.error(`Файл для перекладу за замовчуванням ${currentDbName} не знайдено.`);
    }
  } else {
    console.warn(`Не знайдено файлів баз даних (.sqlite3, .sqlite).`);
    dialog.showMessageBox({
      type: 'info',
      title: 'Необхідно додати переклади',
      message: 'Не знайдено файлів перекладів.',
      detail: `Програма може включати стандартні переклади. Ви також можете додати власні, помістивши файли (.sqlite3 або .sqlite) у цю папку:\n\n${userTranslationsPath}`,
      buttons: ['Відкрити папку', 'OK']
    }).then(result => {
      if (result.response === 0) { // 'Відкрити папку' button
        shell.openPath(userTranslationsPath);
      }
    });
  }

  // Встановлюємо іконку для Dock на macOS
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
  }

  createAdminWindow();

  // Перевірка оновлень після створення головного вікна та далі кожні 4 години
  // (лише у встановленій програмі — у режимі розробки оновлення недоступні)
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(err => log.error('Update check failed:', err));
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(err => log.error('Update check failed:', err));
    }, 4 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    // На macOS зазвичай повторно створюють вікно, коли клікають на іконку в доці
    // і немає інших відкритих вікон.
    if (BrowserWindow.getAllWindows().length === 0) {
      createAdminWindow();
    }
  });
});

// Обробка закриття всіх вікон
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Закриваємо з'єднання з БД перед виходом з програми
app.on('will-quit', () => {
  if (db) {
    db.close();
    console.log('З\'єднання з базою даних закрито.');
  }
  if (secondaryDb) {
    secondaryDb.close();
    console.log('З\'єднання з другим перекладом закрито.');
  }
});

// Слухаємо команди з вікна адміністратора

// Команда на відкриття вікна проектора
ipcMain.on('open-projector', () => {
  console.log('[main] Отримано команду "open-projector"');
  if (!projectorWindow) {
    createProjectorWindow();
  } else {
    console.log('[main] Вікно проектора вже існує, фокусуємось.');
    projectorWindow.focus();
  }
});

// Команда на вибір фонового зображення
ipcMain.handle('select-background-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(adminWindow, {
    title: 'Оберіть фонове зображення',
    properties: ['openFile'],
    filters: [
      { name: 'Зображення', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ]
  });

  if (canceled || filePaths.length === 0) {
    return { path: null };
  }

  const imagePath = filePaths[0];

  // Оновлюємо налаштування і відправляємо у вікно проектора
  projectorSettings.backgroundImage = imagePath;
  saveSettings(); // Зберігаємо налаштування

  // Конвертуємо шлях у URL для відправки у вікно
  const imageUrl = url.format({ pathname: imagePath, protocol: 'file:', slashes: true });
  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.webContents.send('settings-updated', { backgroundImage: imageUrl });
  }

  return { path: imagePath }; // Повертаємо шлях для відображення в адмін-панелі
});

// --- Обробка подій auto-updater ---

// Надсилає подію у вікно адміністратора, якщо воно ще відкрите
function sendToAdmin(channel, ...args) {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.webContents.send(channel, ...args);
  }
}

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  sendToAdmin('update-available', info.version);
});

autoUpdater.on('update-not-available', () => {
  log.info('Update not available.');
  sendToAdmin('update-not-available');
});

autoUpdater.on('download-progress', (progress) => {
  sendToAdmin('update-download-progress', Math.round(progress.percent));
});

autoUpdater.on('update-downloaded', () => {
  log.info('Update downloaded.');
  sendToAdmin('update-downloaded');
});

autoUpdater.on('error', (err) => {
  log.error('Updater error:', err);
  sendToAdmin('update-error', err.message || String(err));
});

// Ручна перевірка оновлень із кнопки в налаштуваннях
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Перевірка оновлень доступна лише у встановленій програмі.' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.on('restart-app-to-update', () => {
  autoUpdater.quitAndInstall();
});

// Застосовує тему інтерфейсу через nativeTheme (керує shouldUseDarkColors)
function applyThemeSetting(theme) {
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
}

// Команда на оновлення налаштувань
ipcMain.on('update-projector-settings', (event, settings) => {
  console.log('[main] Отримано оновлення налаштувань:', settings);

  if (settings.theme) {
    applyThemeSetting(settings.theme);
  }

  // Обробка вкладених налаштувань, як-от кольори категорій
  if (settings.categoryColors) {
    projectorSettings.categoryColors = {
      ...projectorSettings.categoryColors,
      ...settings.categoryColors
    };
    delete settings.categoryColors;
  }
  projectorSettings = { ...projectorSettings, ...settings };

  saveSettings(); // Зберігаємо налаштування

  // Готуємо дані для відправки (конвертуємо шлях зображення в URL, якщо він є)
  const settingsForRenderer = { ...settings };
  if (settingsForRenderer.hasOwnProperty('backgroundImage') && settingsForRenderer.backgroundImage) {
    settingsForRenderer.backgroundImage = url.format({
      pathname: settingsForRenderer.backgroundImage,
      protocol: 'file:',
      slashes: true
    });
  }

  if (projectorWindow && !projectorWindow.isDestroyed()) {
    projectorWindow.webContents.send('settings-updated', settingsForRenderer);
  }
});

// Команда на отримання поточних налаштувань
ipcMain.handle('get-settings', () => {
  return { ...projectorSettings }; // Повертаємо копію, щоб уникнути випадкових змін
});

// Команда на показ вірша
ipcMain.on('show-verse', (event, verseData) => {
  if (projectorWindow) {
    console.log(`[main] Надсилаємо дані у проектор:`, verseData);
    // Надсилаємо дані у вікно проектора
    projectorWindow.webContents.send('display-verse', verseData);
  } else {
    console.log('[main] Помилка: спроба надіслати текст у закрите вікно проектора.');
  }
});

// Команда на отримання списку доступних перекладів
ipcMain.handle('get-translations', () => {
  try {
    return getAllTranslations();
  } catch (err) {
    console.error('Помилка під час отримання списку перекладів:', err);
    return [];
  }
});

// Команда для переключення активної бази даних (перекладу)
ipcMain.handle('switch-translation', (event, dbName) => {
  if (currentDbName === dbName && db && db.open) {
    return { success: true, message: `Переклад ${dbName} вже активний.` };
  }

  const dbPath = getTranslationDbPath(dbName);
  if (!dbPath) {
    return { success: false, message: `Файл перекладу ${dbName} не знайдено.` };
  }

  try {
    if (db && db.open) {
      db.close();
      console.log(`З'єднання з ${currentDbName} закрито.`);
    }

    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    currentDbName = dbName;
    console.log(`Успішно переключено на базу даних ${dbName}`);
    return { success: true, message: `Переключено на ${dbName}` };
  } catch (err) {
    console.error(`Не вдалося переключитися на базу даних ${dbName}:`, err.message);
    currentDbName = '';
    db = null;
    return { success: false, message: `Помилка підключення до ${dbName}` };
  }
});

// Команда на отримання списку книг з БД
ipcMain.handle('get-books', async () => {
  if (!db) {
    console.warn('Спроба отримати книги без підключеної бази даних.');
    return []; // Повертаємо порожній масив, якщо немає підключення до БД
  }
  try {
    // Припустимо, у вас є таблиця 'books' з колонками 'id', 'short_name', 'long_name'
    // Використовуємо 'book_number' як ідентифікатор і даємо йому псевдонім 'id' для сумісності з фронтендом
    const stmt = db.prepare('SELECT book_number as id, short_name, long_name FROM books ORDER BY book_number');
    const books = stmt.all();
    
    // Знаходимо індекс Євангелія від Матвія. 
    // Це найнадійніший спосіб визначити структуру Біблії (Синодальна чи Протестантська),
    // не покладаючись на внутрішні ID, які часто відрізняються в різних перекладах.
    const matthewIndex = books.findIndex(b => 
      /^(мт|мат|мф|mat|matt)/i.test(b.short_name) || 
      /матв|матф|matthew/i.test(b.long_name)
    );

    // Додаємо категорію до кожної книги
    const booksWithCategory = books.map((book, index) => {
      let category = '';
      
      // 1. Новий Заповіт (структура ідентична у всіх стандартних канонах)
      if (matthewIndex !== -1 && index >= matthewIndex) {
        const ntIndex = index - matthewIndex;
        if (ntIndex >= 0 && ntIndex <= 3) category = 'gospels'; // Матвія - Івана
        else if (ntIndex === 4) category = 'acts'; // Дії
        else if (ntIndex >= 5 && ntIndex <= 25) category = 'epistles'; // Послання
        else if (ntIndex === 26) category = 'revelation'; // Об'явлення
      } 
      // 2. Старий Заповіт - Протестантський канон (39 книг)
      else if (matthewIndex === 39) {
        if (index >= 0 && index <= 4) category = 'pentateuch';
        else if (index >= 5 && index <= 16) category = 'historical';
        else if (index >= 17 && index <= 21) category = 'poetic';
        else if (index >= 22 && index <= 38) category = 'prophetic';
      }
      // 3. Старий Заповіт - Синодальний канон (50 книг)
      else if (matthewIndex === 50) {
        if (index >= 0 && index <= 4) category = 'pentateuch';
        else if (index >= 5 && index <= 19) category = 'historical';
        else if (index >= 20 && index <= 26) category = 'poetic';
        else if (index >= 27 && index <= 45) category = 'prophetic';
        else if (index >= 46 && index <= 49) category = 'historical';
      }
      // 4. Універсальний Fallback по назві книги (для дуже нестандартних модулів Біблії)
      else {
        const short = book.short_name.toLowerCase();
        if (/^(бут|быт|вих|исх|лев|чис|повт|втор|gen|exo|lev|num|deut)/.test(short)) category = 'pentateuch';
        else if (/^(нав|суд|рут|руф|цар|сам|хр|пар|езд|езр|неем|ест|есф|тов|юдиф|мак|josh|judg|ruth|sam|ki|chr|ezr|neh|est|tob|mac)/.test(short)) category = 'historical';
        else if (/^(йов|иов|пс|прит|ек|пісн|пес|мудр|сир|job|psa|pro|ecc|song|wis|sir)/.test(short)) category = 'poetic';
        else if (/^(іс|ис|єр|иер|плач|вар|єз|иез|езе|дан|ос|йоїл|иоил|ам|овд|авд|йон|ион|мих|наум|авак|авв|соф|ог|агг|зах|мал|isa|jer|lam|bar|eze|dan|hos|joe|amo|oba|jon|mic|nah|hab|zep|hag|zec|mal)/.test(short)) category = 'prophetic';
        else if (/^(мт|мат|мф|мк|мар|лк|лук|ів|ин|иоан|mat|mar|luk|joh)/.test(short)) category = 'gospels';
        else if (/^(дії|деян|act)/.test(short)) category = 'acts';
        else if (/^(рим|кор|гал|еф|філ|фил|кол|сол|фес|тим|тит|флм|євр|евр|як|иак|пет|юд|иуд|rom|cor|gal|eph|php|col|th|tim|tit|phm|heb|jam|pet|jud)/.test(short)) category = 'epistles';
        else if (/^(об|отк|rev|apoc)/.test(short)) category = 'revelation';
      }

      return { ...book, category };
    });

    return booksWithCategory;
  } catch (err) {
    console.error('Помилка при зчитуванні книг з БД:', err);
    throw err; // Перекидаємо помилку далі, щоб фронтенд її отримав
  }
});

// Команда на отримання списку розділів для книги
ipcMain.handle('get-chapters', async (event, bookId) => {
  if (!db) {
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }
  try {
    // Знаходимо максимальний номер розділу для вибраної книги
    const stmt = db.prepare('SELECT MAX(chapter) as chapter_count FROM verses WHERE book_number = ?');
    const result = stmt.get(bookId);
    const chapterCount = result ? result.chapter_count : 0;
    // Повертаємо масив чисел від 1 до chapterCount
    return Array.from({ length: chapterCount }, (_, i) => i + 1);
  } catch (err) {
    console.error(`Помилка при отриманні розділів для книги ${bookId}:`, err);
    throw err;
  }
});

// Команда на отримання списку віршів для розділу
ipcMain.handle('get-verses', async (event, { bookId, chapter }) => {
  if (!db) {
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }
  try {
    // Знаходимо максимальний номер вірша для вибраного розділу
    const stmt = db.prepare('SELECT MAX(verse) as verse_count FROM verses WHERE book_number = ? AND chapter = ?');
    const result = stmt.get(bookId, chapter);
    const verseCount = result ? result.verse_count : 0;
    // Повертаємо масив чисел від 1 до verseCount
    return Array.from({ length: verseCount }, (_, i) => i + 1);
  } catch (err) {
    console.error(`Помилка при отриманні віршів для книги ${bookId}, розділу ${chapter}:`, err);
    throw err;
  }
});

// Функція для очищення тексту вірша від тегів
function cleanVerseText(text) {
  if (typeof text !== 'string') return '';
  
  // 1. Видаляємо теги виносок (напр. <f>...</f>) разом із їхнім вмістом.
  // Оригінальний код мав занадто широке правило, яке зачіпало <i>, <b> і т.д.
  let cleanedText = text.replace(/<f>.*?<\/f>/gi, '');

  // 2. Видаляємо всі інші HTML-теги, замінюючи їх на пробіл, щоб зберегти вміст.
  // Це обробить <b>, <i>, <p>, <br> та інші, не склеюючи слова.
  cleanedText = cleanedText.replace(/<[^>]+>/g, ' ');

  // 3. Нормалізуємо пробіли (кілька пробілів -> один) і прибираємо зайві на початку/кінці.
  return cleanedText.replace(/\s+/g, ' ').trim();
}

// Команда на отримання тексту всіх віршів у розділі
ipcMain.handle('get-chapter-text', async (event, { bookId, chapter }) => {
  if (!db) {
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }
  try {
    const stmt = db.prepare(`
      SELECT verse, text 
      FROM verses 
      WHERE book_number = ? AND chapter = ?
      ORDER BY verse ASC
    `);
    const verses = stmt.all(bookId, chapter);
    // Очищуємо текст віршів від тегів форматування
    return verses.map(v => ({
      ...v,
      text: cleanVerseText(v.text)
    }));
  } catch (err) {
    console.error(`Помилка при отриманні тексту розділу для книги ${bookId}, розділу ${chapter}:`, err);
    throw err;
  }
});

// Читає текст вірша(ів) із заданої бази даних і повертає { reference, text }
function readVerseFromDb(database, bookId, chapter, versesStr) {
  // 1. Отримуємо назву книги для посилання
  const bookQuery = database.prepare('SELECT long_name, short_name FROM books WHERE book_number = ?');
  const book = bookQuery.get(bookId);
  if (!book) {
    throw new Error(`Книгу з ID ${bookId} не знайдено.`);
  }

  // 2. Парсимо рядок з віршами (напр. "16", "16-18")
  const verseParts = versesStr.split('-').map(v => parseInt(v.trim(), 10));
  let startVerse, endVerse;

  if (verseParts.length === 1 && !isNaN(verseParts[0])) {
    startVerse = endVerse = verseParts[0];
  } else if (verseParts.length === 2 && !isNaN(verseParts[0]) && !isNaN(verseParts[1])) {
    startVerse = Math.min(verseParts[0], verseParts[1]);
    endVerse = Math.max(verseParts[0], verseParts[1]);
  } else {
    throw new Error(`Неправильний формат вірша: ${versesStr}`);
  }

  // 3. Отримуємо вірші з бази даних
  const verseQuery = database.prepare(`
    SELECT verse, text
    FROM verses
    WHERE book_number = ? AND chapter = ? AND verse BETWEEN ? AND ?
    ORDER BY verse ASC
  `);
  const verseRows = verseQuery.all(bookId, chapter, startVerse, endVerse);

  if (verseRows.length === 0) {
    return { reference: `${book.short_name} ${chapter}:${versesStr}`, text: '(Текст не знайдено)' };
  }

  // 4. Форматуємо результат
  const reference = `${book.long_name} ${chapter}:${versesStr}`;
  // Очищуємо текст від тегів і об'єднуємо вірші (кожен — з нового рядка).
  const fullText = verseRows.map(row => cleanVerseText(row.text)).join('\n');

  return { reference, text: fullText };
}

// Команда на отримання тексту вірша з основної БД
ipcMain.handle('get-verse-text', async (event, { bookId, chapter, versesStr }) => {
  if (!db) {
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }
  try {
    return readVerseFromDb(db, bookId, chapter, versesStr);
  } catch (err) {
    console.error('Помилка при зчитуванні вірша з БД:', err);
    throw err; // Перекидаємо помилку
  }
});

// Команда на отримання того ж вірша з другого (паралельного) перекладу
ipcMain.handle('get-secondary-verse-text', async (event, { bookId, chapter, versesStr }) => {
  if (!secondaryDb) return null; // Паралельний переклад не активний
  try {
    const result = readVerseFromDb(secondaryDb, bookId, chapter, versesStr);
    return { text: result.text, reference: result.reference, name: secondaryDbName };
  } catch (err) {
    console.error('Помилка при зчитуванні вірша з другого перекладу:', err);
    return null;
  }
});

// Команда для увімкнення/перемикання другого перекладу (null/'' — вимкнути)
ipcMain.handle('set-secondary-translation', (event, dbName) => {
  // Вимкнення паралельного перекладу
  if (!dbName) {
    if (secondaryDb && secondaryDb.open) secondaryDb.close();
    secondaryDb = null;
    secondaryDbName = '';
    projectorSettings.secondaryTranslation = null;
    saveSettings();
    return { success: true };
  }

  // Якщо вже відкрито потрібний переклад — нічого не робимо
  if (secondaryDbName === dbName && secondaryDb && secondaryDb.open) {
    return { success: true, message: `Другий переклад ${dbName} вже активний.` };
  }

  const dbPath = getTranslationDbPath(dbName);
  if (!dbPath) {
    return { success: false, message: `Файл перекладу ${dbName} не знайдено.` };
  }

  try {
    if (secondaryDb && secondaryDb.open) secondaryDb.close();
    secondaryDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    secondaryDbName = dbName;
    projectorSettings.secondaryTranslation = dbName;
    saveSettings();
    console.log(`Другий переклад переключено на ${dbName}`);
    return { success: true, message: `Другий переклад: ${dbName}` };
  } catch (err) {
    console.error(`Не вдалося відкрити другий переклад ${dbName}:`, err.message);
    secondaryDb = null;
    secondaryDbName = '';
    return { success: false, message: `Помилка підключення до ${dbName}` };
  }
});

// Пошук віршів за текстом
ipcMain.handle('search-verses', async (event, { query }) => {
  if (!db) throw new Error('Немає з\'єднання з базою даних.');

  const words = query.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];

  // SQLite LOWER() does not handle Cyrillic, so we search for both
  // the lowercase form (words in the middle of a sentence) and the
  // capitalized form (proper nouns, sentence starts like "Бог").
  const conditions = words.map(() => '(v.text LIKE ? OR v.text LIKE ?)').join(' AND ');
  const params = [];
  for (const w of words) {
    params.push(`%${w}%`);
    params.push(`%${w.charAt(0).toUpperCase() + w.slice(1)}%`);
  }

  const stmt = db.prepare(`
    SELECT v.book_number as bookId, v.chapter, v.verse, v.text, b.short_name as shortName, b.long_name as longName
    FROM verses v
    JOIN books b ON b.book_number = v.book_number
    WHERE ${conditions}
    LIMIT 40
  `);

  return stmt.all(...params).map(row => ({ ...row, text: cleanVerseText(row.text) }));
});

// Обробка теми системи

// Надсилаємо подію оновлення теми у вікно адміністратора
nativeTheme.on('updated', () => {
  const isDark = nativeTheme.shouldUseDarkColors;
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.webContents.send('theme-updated', isDark);
  }
});

// Надаємо початковий стан теми на запит від вікна
ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors;
});