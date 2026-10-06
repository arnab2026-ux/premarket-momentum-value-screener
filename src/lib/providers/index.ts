import type { MarketDataProvider } from "../types";
import type { ScreenerConfig } from "@config/screener.config";
import { FmpProvider } from "./fmp";
import { MockProvider } from "./mock";

/** Provider factory: add a new adapter (e.g. Polygon) by implementing MarketDataProvider and registering here. */
export function createProvider(cfg: ScreenerConfig, runDate: string, override?: string): MarketDataProvider {
  const kind = override ?? process.env.DATA_PROVIDER ?? "fmp";
  switch (kind) {
    case "mock": return new MockProvider(runDate);
    case "fmp": return new FmpProvider(process.env.FMP_API_KEY ?? "", cfg.universe, runDate);
    default: throw new Error(`Unknown DATA_PROVIDER "${kind}"`);
  }
}
