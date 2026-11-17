// Syphon-вихід (лише macOS): віддає картинку проектора іншим програмам
// (ProPresenter, OBS, Resolume) напряму через відеопам'ять, без окремого вікна.
//
// Як працює: невидиме вікно малює projector.html поза екраном (offscreen) у
// заданому розмірі; Electron віддає новий кадр лише коли щось змінилось,
// і цей кадр публікується як Syphon-сервер «Bible Projector».

const { BrowserWindow, screen } = require('electron');
const path = require('path');

const SERVER_NAME = 'Bible Projector';
const FRAME_RATE = 15; // кадрів/с максимум; реально кадри йдуть лише при змінах
const KEEPALIVE_MS = 1000; // повторна публікація останнього кадру для клієнтів, що підключились пізніше

let SyphonMetalServer = null;
let loadError = null;

// Чи доступний Syphon на цій системі (macOS + нативний модуль завантажився)
function isAvailable() {
  if (process.platform !== 'darwin') return false;
  if (SyphonMetalServer) return true;
  if (loadError) return false;
  try {
    ({ SyphonMetalServer } = require('node-syphon'));
    return true;
  } catch (err) {
    loadError = err;
    console.error('[syphon] Модуль node-syphon не завантажився:', err.message);
    return false;
  }
}

let server = null;
let win = null;
let current = { width: 0, height: 0 };
let lastFrame = null; // { rgba, width, height }
let keepalive = null;
let frames = 0;

function publish(rgba, width, height) {
  if (!server) return;
  server.publishImageData(
    rgba,
    { x: 0, y: 0, width, height },
    { width, height },
    false // кадр уже йде зверху вниз, як у Metal; перевертати не треба
  );
}

// BGRA (bitmap Electron) -> RGBA (чекає node-syphon)
function toRGBA(bitmap) {
  const rgba = new Uint8ClampedArray(bitmap.length);
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2];
    rgba[i + 1] = bitmap[i + 1];
    rgba[i + 2] = bitmap[i];
    rgba[i + 3] = bitmap[i + 3];
  }
  return rgba;
}

/**
 * Запускає Syphon-вихід із кадром width × height пікселів.
 * onLoaded(win) викликається, коли сторінка проектора готова приймати повідомлення.
 */
function start({ width, height, onLoaded }) {
  if (!isAvailable()) return false;
  if (win && !win.isDestroyed() && current.width === width && current.height === height) return true;
  stop();

  server = new SyphonMetalServer(SERVER_NAME);
  current = { width, height };

  // На Retina offscreen-вікно малюється з масштабом екрана (2x). Щоб кадр був
  // рівно width × height пікселів, вікно робимо у scale разів меншим, а
  // сторінку масштабуємо на 1/scale: 1 CSS-піксель = 1 піксель кадру.
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  win = new BrowserWindow({
    width: Math.round(width / scale),
    height: Math.round(height / scale),
    show: false,
    webPreferences: {
      offscreen: true,
      zoomFactor: 1 / scale,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.webContents.setFrameRate(FRAME_RATE);

  win.webContents.on('paint', (event, dirty, image) => {
    if (!server) return;
    const size = image.getSize();
    const rgba = toRGBA(image.toBitmap());
    lastFrame = { rgba, width: size.width, height: size.height };
    publish(rgba, size.width, size.height);
    frames++;
  });

  win.webContents.on('did-finish-load', () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.setZoomFactor(1 / scale);
    if (onLoaded) onLoaded(win);
  });

  // second=1 — та сама поведінка, що в додаткового вікна (зсув тексту тощо)
  win.loadFile('projector.html', { query: { second: '1', syphon: '1' } })
    .catch(err => console.error('[syphon] Не вдалося завантажити projector.html:', err));

  keepalive = setInterval(() => {
    if (lastFrame && server) publish(lastFrame.rgba, lastFrame.width, lastFrame.height);
  }, KEEPALIVE_MS);

  console.log(`[syphon] Сервер «${SERVER_NAME}» запущено, кадр ${width}×${height}`);
  return true;
}

function stop() {
  if (keepalive) { clearInterval(keepalive); keepalive = null; }
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  if (server) {
    try { server.dispose(); } catch (e) { /* ігноруємо */ }
    server = null;
    console.log('[syphon] Сервер зупинено');
  }
  lastFrame = null;
  current = { width: 0, height: 0 };
}

// Вікно для розсилки повідомлень (display-verse, settings-updated), якщо запущено
function window() {
  return win && !win.isDestroyed() ? win : null;
}

function status() {
  return {
    available: isAvailable(),
    running: !!server,
    name: SERVER_NAME,
    width: current.width,
    height: current.height,
    hasClients: server ? !!server.hasClients : false,
    frames
  };
}

module.exports = { isAvailable, start, stop, window, status };
