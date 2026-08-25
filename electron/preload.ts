/** Minimal, context-isolated bridge for the Electron shell. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', { title, body }),
  platform: process.platform,
}));
