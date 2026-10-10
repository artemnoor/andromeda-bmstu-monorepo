declare global {
  const __ANDROMEDA_REACT_PROFILE__: boolean;

  interface Window {
    __andromedaReactProfileSamples?: {
      readonly id: string;
      readonly phase: "mount" | "update" | "nested-update";
      readonly actualDuration: number;
      readonly baseDuration: number;
      readonly startTime: number;
      readonly commitTime: number;
    }[];
  }
}

export {};
