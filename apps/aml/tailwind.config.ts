import type { Config } from 'tailwindcss';
import preset from '@synapcores/app-framework/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    './node_modules/@synapcores/app-framework/src/**/*.{ts,tsx}',
  ],
};

export default config;
