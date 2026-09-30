import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  ...next,
  ...ts,
  { ignores: [".next/**", "node_modules/**", ".pgtest/**", ".data/**", "next-env.d.ts"] },
];

export default config;
