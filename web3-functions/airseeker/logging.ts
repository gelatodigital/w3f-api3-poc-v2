
const debug = (message: string) =>
  console.debug(message);
const error = (message: string, error: Error | null = null) =>
  console.error(message, error);
const info = (message: string) =>
  console.info(message);
const log = (message: string) =>
  console.log(message);
const warn = (message: string) =>
  console.warn(message);



export const logger = {
  debug,
  error,
  info,
  log,
  warn,
};
