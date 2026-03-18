export type AppPlatform = "desktop" | "web";

export type AppCapabilities = {
  platform: AppPlatform;
  localRuntime: boolean;
  terminal: boolean;
  projectShell: boolean;
  autoUpdate: boolean;
  speechToText: boolean;
};

export function getAppCapabilities(): AppCapabilities {
  if (typeof window === "undefined" || !window.appShell?.getCapabilities) {
    return {
      platform: "desktop",
      localRuntime: true,
      terminal: true,
      projectShell: true,
      autoUpdate: true,
      speechToText: true,
    };
  }
  return window.appShell.getCapabilities();
}
