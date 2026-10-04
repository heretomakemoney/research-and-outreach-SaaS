// Number formatting for the screens.
export const usd = (n: number) => `$${n.toFixed(4)}`;
export const usd2 = (n: number) => `$${n.toFixed(2)}`;
export const num = (n: number) => n.toLocaleString("en-AU");
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
