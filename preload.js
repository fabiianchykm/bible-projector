const { contextBridge, ipcRenderer } = require('electron');

// Створюємо безпечний міст між кодом у браузері та головним процесом Electron
contextBridge.exposeInMainWorld('electronAPI', {
  openProjector: () => ipcRenderer.send('open-projector'),
  showVerse: (verseText) => ipcRenderer.send('show-verse', verseText),
  onDisplayVerse: (callback) => ipcRenderer.on('display-verse', (event, ...args) => callback(...args)),
  onThemeUpdated: (callback) => ipcRenderer.on('theme-updated', (event, isDark) => callback(isDark)),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  getTranslations: () => ipcRenderer.invoke('get-translations'),
  switchTranslation: (dbName) => ipcRenderer.invoke('switch-translation', dbName),
  getBooks: () => ipcRenderer.invoke('get-books'),
  getChapters: (bookId) => ipcRenderer.invoke('get-chapters', bookId),
  getVerses: (params) => ipcRenderer.invoke('get-verses', params),
  getChapterText: (params) => ipcRenderer.invoke('get-chapter-text', params),
  getVerseText: (params) => ipcRenderer.invoke('get-verse-text', params),
});