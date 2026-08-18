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
  setSecondaryTranslation: (dbName) => ipcRenderer.invoke('set-secondary-translation', dbName),
  getSecondaryVerseText: (params) => ipcRenderer.invoke('get-secondary-verse-text', params),
  getBooks: () => ipcRenderer.invoke('get-books'),
  getChapters: (bookId) => ipcRenderer.invoke('get-chapters', bookId),
  getVerses: (params) => ipcRenderer.invoke('get-verses', params),
  getChapterText: (params) => ipcRenderer.invoke('get-chapter-text', params),
  getVerseText: (params) => ipcRenderer.invoke('get-verse-text', params),
  searchVerses: (params) => ipcRenderer.invoke('search-verses', params),
  // API для онлайн-каталогу модулів перекладів
  getModulesCatalog: () => ipcRenderer.invoke('get-modules-catalog'),
  downloadModule: (moduleId) => ipcRenderer.invoke('download-module', moduleId),
  // API для налаштувань
  updateProjectorSettings: (settings) => ipcRenderer.send('update-projector-settings', settings),
  onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (event, ...args) => callback(...args)),
  selectBackgroundImage: () => ipcRenderer.invoke('select-background-image'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  // API пульта помічника
  getRemoteInfo: () => ipcRenderer.invoke('get-remote-info'),
  setRemoteEnabled: (enabled) => ipcRenderer.invoke('set-remote-enabled', enabled),
  onRemoteProposal: (callback) => ipcRenderer.on('remote-proposal', (event, proposal) => callback(proposal)),
  openDonate: () => ipcRenderer.send('open-donate'),
  // API для оновлень
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, version) => callback(version)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', () => callback()),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, percent) => callback(percent)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', () => callback()),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, message) => callback(message)),
  restartAppToUpdate: () => ipcRenderer.send('restart-app-to-update'),
});