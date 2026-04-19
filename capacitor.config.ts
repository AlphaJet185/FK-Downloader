import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.alphajet.fkdownloader',
  appName: 'FK Downloader',
  webDir: 'public',
  server: {
    androidScheme: 'https'
  }
};

export default config;
