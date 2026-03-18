---
title: Installation
description: How to install the OneShot desktop app on macOS, Windows, and Linux.
---

## System requirements

| Platform | Minimum |
|----------|---------|
| macOS | 13 Ventura or later, Apple Silicon or Intel |
| Windows | Windows 10 (22H2) or later, x64 |
| Linux | Ubuntu 22.04+, Debian 12+, Arch (x64) |

## Download

Download the latest installer from the [GitHub releases page](https://github.com/capzeroai/one-shot/releases).

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `OneShot-arm64.dmg` |
| macOS (Intel) | `OneShot-x64.dmg` |
| Windows | `OneShot-Setup.exe` |
| Linux (AppImage) | `OneShot.AppImage` |
| Linux (deb) | `OneShot.deb` |

## macOS

1. Open the `.dmg` file
2. Drag OneShot to your Applications folder
3. Right-click the app and choose **Open** on first launch (to bypass Gatekeeper)

## Windows

1. Run the `OneShot-Setup.exe` installer
2. Follow the installation wizard
3. OneShot launches automatically after installation

## Linux

**AppImage:**
```bash
chmod +x OneShot.AppImage
./OneShot.AppImage
```

**Debian/Ubuntu:**
```bash
sudo dpkg -i OneShot.deb
```

## Auto-updates

OneShot checks for updates automatically and notifies you when a new version is available. Updates are installed on the next launch.
