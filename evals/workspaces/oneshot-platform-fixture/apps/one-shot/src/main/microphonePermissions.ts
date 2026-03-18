import { shell, systemPreferences } from 'electron';
import log from 'electron-log/main';

export const MICROPHONE_PERMISSION_ERROR =
  'Microphone permission is denied. Enable One Shot in System Settings > Privacy & Security > Microphone.';

export function getMacMicrophoneAccessStatus() {
  if (process.platform !== 'darwin') {
    return 'granted' as const;
  }
  return systemPreferences.getMediaAccessStatus('microphone');
}

export async function requestMacMicrophoneAccessIfNeeded(source: string): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }

  const status = systemPreferences.getMediaAccessStatus('microphone');
  log.info(`[mic] (${source}) macOS microphone access status: ${status}`);

  if (status === 'granted') {
    return true;
  }

  if (status === 'not-determined') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    log.info(`[mic] (${source}) macOS microphone access ${granted ? 'granted' : 'denied'}`);
    return granted;
  }

  log.warn(`[mic] (${source}) macOS microphone access requires manual enable in System Settings > Privacy & Security > Microphone`);
  return false;
}

export async function openMacMicrophoneSettings(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }
  try {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    return true;
  } catch (error) {
    log.warn(`[mic] failed to open macOS microphone settings: ${String(error)}`);
    return false;
  }
}
