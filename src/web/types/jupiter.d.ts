export {};

declare global {
  interface Window {
    Jupiter?: {
      init(opts: Record<string, unknown>): void;
      syncProps(props: Record<string, unknown>): void;
      close?(): void;
    };
  }
}
