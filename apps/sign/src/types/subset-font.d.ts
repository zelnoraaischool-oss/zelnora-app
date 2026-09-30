declare module "subset-font" {
  interface SubsetOptions {
    targetFormat?: "sfnt" | "truetype" | "woff" | "woff2";
    keepFeatures?: string[];
    noLayoutClosure?: boolean;
    preserveNameIds?: number[];
  }
  export default function subsetFont(font: Buffer, text: string, options?: SubsetOptions): Promise<Buffer>;
}
