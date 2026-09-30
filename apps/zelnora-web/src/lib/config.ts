export const API_URL: string = import.meta.env.VITE_API_URL ?? "";
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
/** APIのURLがなければ、ブラウザ内で動くデモモード */
export const DEMO = !API_URL || API_URL === "demo";
