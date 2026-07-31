import { useEffect } from "react";

import {
  initializeAnalytics,
  type AnalyticsConfig,
} from "~/lib/analytics";

export function Analytics({ config }: { config: AnalyticsConfig | null }) {
  useEffect(() => {
    if (config) void initializeAnalytics(config);
  }, [config?.apiHost, config?.projectToken, config?.site]);

  return null;
}
