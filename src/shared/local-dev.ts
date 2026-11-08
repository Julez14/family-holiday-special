export const LOCAL_DEV_ORIGIN = 'https://localhost:8787';
export const localDevMessage = (method: string, path: string, time: string) =>
  `local-dev-v1:${method}:${path}:${time}`;
