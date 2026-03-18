import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';

// Repository coordinates for GitHub Releases (used by publisher + auto-updater feed).
// Set GITHUB_RELEASE_OWNER / GITHUB_RELEASE_REPO in CI, or override here for personal forks.
const RELEASE_OWNER = process.env.GITHUB_RELEASE_OWNER ?? 'apethree';
const RELEASE_REPO = process.env.GITHUB_RELEASE_REPO ?? 'one-shot';

// Apple Developer Team ID for Nitin Arya.
const APPLE_TEAM_ID = 'SL864L4ACG';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: ['resources/openclaw-runtime'],
    extendInfo: {
      NSMicrophoneUsageDescription: 'One Shot needs microphone access for voice dictation and speech-to-text input.',
    },
    // Electron Packager resolves platform-specific icon files from this base path.
    // For macOS, this maps to `resources/icons/icon.icns`.
    icon: process.platform === 'darwin' ? 'resources/icons/icon' : undefined,
    // --- macOS code signing + notarization -------------------------------------------
    // Requires a "Developer ID Application" certificate in Keychain.
    // You currently have Apple Development + Apple Distribution certs (App Store flow).
    // To get the right cert: developer.apple.com → Certificates → "Developer ID Application"
    // Download, double-click to install, then uncomment these blocks.
    //
    // osxSign: {
    //   identity: `Developer ID Application: Nitin Arya (${APPLE_TEAM_ID})`,
    //   entitlements: path.resolve(__dirname, 'resources/macos/entitlements.mac.plist'),
    //   entitlementsInherit: path.resolve(__dirname, 'resources/macos/entitlements.mac.inherit.plist'),
    // },
    // osxNotarize: {
    //   tool: 'notarytool',
    //   appleId: 'nitin.ar@icloud.com',
    //   appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,  // app-specific password from appleid.apple.com
    //   teamId: APPLE_TEAM_ID,
    // },
    // ---------------------------------------------------------------------------------
  },
  rebuildConfig: {},
  makers: [
    // Windows: Squirrel installer (.exe) — auto-update-capable
    new MakerSquirrel({
      // Windows code signing (optional for dev, required for production SmartScreen).
      // certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      // certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
    }),
    // macOS: ZIP containing .app — used by electron-updater for background updates
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: RELEASE_OWNER, name: RELEASE_REPO },
      // Releases are created as drafts — review and publish manually in GitHub UI.
      // Change to false to auto-publish immediately.
      draft: true,
      prerelease: false,
      // The publisher generates latest.yml / latest-mac.yml and uploads them alongside
      // the binary artifacts. electron-updater reads these files to detect new versions.
      generateReleaseNotes: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
