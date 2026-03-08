export interface ServiceStatus {
  name: string;
  url: string;
  healthy: boolean;
}

const SERVICES = [
  { name: "neo4j", url: "http://127.0.0.1:7474" },
  { name: "embeddings-service", url: "http://127.0.0.1:8000/health" },
  { name: "graph-service", url: "http://127.0.0.1:8001/health" },
  { name: "analysis-service", url: "http://127.0.0.1:8002/health" },
  { name: "mcp-server", url: "http://127.0.0.1:3001/health" },
  { name: "web-ui", url: "http://127.0.0.1:3000" },
];

export async function checkAllServices(): Promise<ServiceStatus[]> {
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(3000) });
        return { ...svc, healthy: res.ok };
      } catch {
        return { ...svc, healthy: false };
      }
    }),
  );
  return results;
}
