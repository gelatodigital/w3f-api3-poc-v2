
import { go } from './go';
import { logger } from './logging';
import { Provider } from './state';

export const getTransactionCount = async (
  provider: Provider,
  sponsorWalletAddress: string,
): Promise<number | null> => {
  const { chainId, rpcProvider, providerName } = provider;

  const goTransactionCount = await go(() => rpcProvider[0].getTransactionCount(sponsorWalletAddress));

  if (!goTransactionCount.success) {
    if (!goTransactionCount.error?.message?.includes('This limiter has been stopped')) {
      logger.warn(`Unable to get transaction count. Error: ${goTransactionCount.error}`);
    }
    return null;
  }

  const transactionCount = goTransactionCount.data as number;
  logger.info(`Transaction count is ${transactionCount}`);

  return transactionCount;
};
