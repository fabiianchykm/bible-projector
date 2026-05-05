const { app, BrowserWindow, ipcMain, screen, nativeTheme, dialog, shell } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

let adminWindow;
let projectorWindow;
let db;
let currentDbName = '';

// Шлях до папки з перекладами в директорії даних користувача
// Для зручності розробки можна тимчасово вказати шлях до папки з перекладами
// всередині проєкту. Для фінальної збірки програми краще повернути рядок нижче.
// const translationsPath = path.join(app.getPath('userData'), 'translations');
const translationsPath = path.join(__dirname, 'translations');

// Переконуємось, що директорія існує
try {
  if (!fs.existsSync(translationsPath)) {
    fs.mkdirSync(translationsPath, { recursive: true });
    console.log(`Створено директорію для перекладів: ${translationsPath}`);
  }
} catch (e) {
  console.error('Не вдалося створити директорію для перекладів:', e);
}

// Функція для створення вікна адміністратора
function createAdminWindow() {
  adminWindow = new BrowserWindow({
    width: 500,
    height: 980,
    icon: path.join(__dirname, 'icon.png'), // Додаємо іконку для вікна
    webPreferences: {
      // preload-скрипт для безпечної комунікації між процесами
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

  projectorWindow.loadFile('projector.html').catch(err => {
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
  let translations = [];
  try {
    const allFiles = fs.readdirSync(translationsPath);
    console.log(`[DEBUG] Знайдено файлів у директорії ${translationsPath}:`, allFiles);

    // Знаходимо всі доступні переклади (файли .sqlite3 або .sqlite) у спеціальній папці
    translations = allFiles.filter(
      file => file.toLowerCase().endsWith('.sqlite3') || file.toLowerCase().endsWith('.sqlite')
    );
  } catch (e) {
    console.error(`Не вдалося прочитати директорію з перекладами (${translationsPath}):`, e.message);
  }

  if (translations.length > 0) {
    // Підключаємось до першого знайденого перекладу за замовчуванням
    currentDbName = translations[0];
    try {
      const dbPath = path.join(translationsPath, currentDbName);
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      console.log(`Успішно підключено до бази даних за замовчуванням: ${currentDbName}`);
    } catch (err) {
      console.error(`Не вдалося підключитися до бази даних ${currentDbName}:`, err.message);
    }
  } else {
    console.error(`Не знайдено файлів баз даних (.sqlite3, .sqlite) у директорії: ${translationsPath}`);
    dialog.showMessageBox({
      type: 'info',
      title: 'Необхідно додати переклади',
      message: 'Папка для файлів перекладів порожня.',
      detail: `Будь ласка, помістіть файли баз даних (.sqlite3 або .sqlite) у цю папку:\n\n${translationsPath}`,
      buttons: ['Відкрити папку', 'OK']
    }).then(result => {
      if (result.response === 0) { // 'Відкрити папку' button
        shell.openPath(translationsPath);
      }
    });
  }

  // Встановлюємо іконку для Dock на macOS
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
  }

  createAdminWindow();

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
    return fs.readdirSync(translationsPath).filter(
      file => file.toLowerCase().endsWith('.sqlite3') || file.toLowerCase().endsWith('.sqlite')
    );
  } catch (err) {
    console.error(`Помилка читання директорії для пошуку перекладів (${translationsPath}):`, err);
    return [];
  }
});

// Команда для переключення активної бази даних (перекладу)
ipcMain.handle('switch-translation', (event, dbName) => {
  if (currentDbName === dbName && db && db.open) {
    return { success: true, message: `Переклад ${dbName} вже активний.` };
  }

  try {
    if (db && db.open) {
      db.close();
      console.log(`З'єднання з ${currentDbName} закрито.`);
    }

    const dbPath = path.join(translationsPath, dbName);
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
    // Краще кидати помилку, щоб фронтенд міг її обробити
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }
  try {
    // Припустимо, у вас є таблиця 'books' з колонками 'id', 'short_name', 'long_name'
    // Використовуємо 'book_number' як ідентифікатор і даємо йому псевдонім 'id' для сумісності з фронтендом
    const stmt = db.prepare('SELECT book_number as id, short_name, long_name FROM books ORDER BY book_number');
    const books = stmt.all();
    return books;
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

// Команда на отримання тексту вірша з БД
ipcMain.handle('get-verse-text', async (event, { bookId, chapter, versesStr }) => {
  if (!db) {
    // Аналогічно, кидаємо помилку
    throw new Error('Немає з\'єднання з базою даних. Будь ласка, виберіть переклад.');
  }

  try {
    // 1. Отримуємо назву книги для посилання
    const bookQuery = db.prepare('SELECT long_name, short_name FROM books WHERE book_number = ?');
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
    // Припускаємо, що є таблиця 'verses' з колонками 'book_number', 'chapter', 'verse', 'text'
    const verseQuery = db.prepare(`
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
    // Очищуємо текст від тегів і об'єднуємо вірші.
    // Якщо обрано кілька віршів, кожен буде з нового рядка для кращої читабельності.
    const fullText = verseRows.map(row => cleanVerseText(row.text)).join('\n');

    return { reference, text: fullText };
  } catch (err) {
    console.error('Помилка при зчитуванні вірша з БД:', err);
    throw err; // Перекидаємо помилку
  }
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