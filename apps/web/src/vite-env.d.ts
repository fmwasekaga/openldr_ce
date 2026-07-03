/// <reference types="vite/client" />

// Injected by Vite `define` from the app package version (see vite.config.ts).
declare const __APP_VERSION__: string;

declare module '*.md?raw' {
  const content: string;
  export default content;
}
