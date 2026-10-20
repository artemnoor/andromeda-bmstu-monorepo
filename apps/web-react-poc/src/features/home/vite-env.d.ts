interface ImportMetaEnv {
  readonly VITE_LEGACY_WEB_BASE_URL?: string;
  readonly VITE_PROF_TEST_LOG_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
