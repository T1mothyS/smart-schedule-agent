/**
 * Electron 主进程入口
 */
import { app, BrowserWindow, shell, Menu, Tray, nativeImage, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 主窗口
let mainWindow: BrowserWindow | null = null;

// 系统托盘
let tray: Tray | null = null;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '智能日程表',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // 先隐藏，等 ready-to-show 再显示
  });

  // 加载应用
  if (isDev) {
    // 开发模式：从 Vite 开发服务器加载
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式：从构建目录加载
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 窗口关闭时隐藏到托盘（可选）
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin') {
      // 非 macOS 系统直接退出
      app.quit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 创建系统托盘
function createTray() {
  // 创建一个简单的托盘图标
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGHSURBVFiF7ZcxTsMwFIb/N0lLF6VgZWFhYOcKLDyBDXegsLGx8BAewNID2LgBS09AaWmhTZMQC6lS4iSO4ziO1f4kie348pMlO3YWQgghhBBCCCGE0BNjvAfOQoi/gL8Ef0IIf0BfgB4YAzPgEvgCpoD/gB8hxLqN7wP+gH7A2B7xM8CPEMJvgCj9gKk9YALcCCHOgO8BxC8g0x54FkK8DCEsgF/AdQjxdQ/4NYR4F0K8CyEuhBCXwOMQ4nUI8SqE+LEH/BJC3AshXgYQr4GPIcTHI+BXCPFzD/gthPgcQrwKIS6FEBfAkxDiVQjx4wj4LYT4egT8DiE+7QG/hRAfhxCfQ4gP+8DfIcSnI+C3EOJTCPEphPgUQrwH/B5CfDoCfocQn4YQn4cQn4YQH4+A3yHE5yPgtxDicwjx6Qj4LYT4fAT8DiE+HQG/Q4jPR8DvEOLTEfA7hPh8BPwOIT4fAb9DiM9HwO8Q4vMR8DuE+HIE/A4hPh0Bv0OIz0fA7xDi8xHwO4T4fAT8DiE+HQG/Q4hPR8DvEOLTEfA7hPh8BPwOIT4fAb9DiM9HwO8Q4vMR8DuE+HIE/A4hPh8Bv0OIz0fA7xDi8xHwO4T4fAT8DiE+HQG/Q4hPR8DvEOLTEfA7hPh8BPwOIT4fAb9DiM9HwO8Q4vMR8PsDvgH/AG5D4nQAAAAASUVORK5CYII='
  );
  
  tray = new Tray(icon);
  tray.setToolTip('智能日程表');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow?.show();
      },
    },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);
  
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    mainWindow?.show();
  });
}

// 创建应用菜单
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('new-chat');
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 显示系统通知
export function showNotification(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// 导出主窗口实例
export function getMainWindow() {
  return mainWindow;
}

// App 事件
app.whenReady().then(() => {
  createMenu();
  createWindow();
  createTray();

  app.on('activate', () => {
    // macOS: 点击 Dock 图标时重新创建窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// 所有窗口关闭时
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
