import { Api3ServerV1__factory as Api3ServerV1Factory } from '@api3/airnode-protocol-v1';

import { ethers } from 'ethers';
import { chunk, isEmpty, isNil } from 'lodash';
import { calculateMedian } from './calculations';
import { checkConditions } from './check-condition';
import {
  DATAFEED_READ_BATCH_SIZE,
  DATAFEED_UPDATE_BATCH_SIZE,
  INT224_MAX,
  INT224_MIN,
  NO_DATA_FEEDS_EXIT_CODE,
} from './constants';
import { logger } from './logging';
import { Provider, getState } from './state';
import { shortenAddress } from './utils';
import { Beacon, BeaconSetTrigger, BeaconTrigger, SignedData } from './validation';
import { go } from './go';

type ProviderSponsorDataFeeds = {
  provider: Provider;
  sponsorAddress: string;
  updateInterval: number;
  beaconTriggers: BeaconTrigger[];
  beaconSetTriggers: BeaconSetTrigger[];
};

export enum DataFeedType {
  Beacon = 'Beacon',
  BeaconSet = 'BeaconSet',
}

// Based on https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/dapis/DapiServer.sol#L878
export const decodeBeaconValue = (encodedBeaconValue: string) => {
  const decodedBeaconValue = ethers.BigNumber.from(
    ethers.utils.defaultAbiCoder.decode(['int256'], encodedBeaconValue)[0]
  );
  if (decodedBeaconValue.gt(INT224_MAX) || decodedBeaconValue.lt(INT224_MIN)) {
    return null;
  }

  return decodedBeaconValue;
};

export const groupDataFeedsByProviderSponsor = () => {
  const { config, providers: stateProviders } = getState();

  return Object.entries(config.triggers.dataFeedUpdates).reduce(
    (acc: ProviderSponsorDataFeeds[], [chainId, dataFeedUpdatesPerSponsor]) => {
      const providers = stateProviders[chainId];

      const providerSponsorGroups = Object.entries(
        dataFeedUpdatesPerSponsor as { [s: string]: { updateInterval: any; beacons: any; beaconSets: any } }
      ).reduce((acc: ProviderSponsorDataFeeds[], [sponsorAddress, { updateInterval, beacons, beaconSets }]) => {
        return [
          ...acc,
          ...providers.map((provider: any) => ({
            provider,
            sponsorAddress,
            updateInterval,
            beaconTriggers: beacons,
            beaconSetTriggers: beaconSets,
          })),
        ];
      }, []);

      return [...acc, ...providerSponsorGroups];
    },
    []
  );
};

export const initiateDataFeedUpdates = async (provider: any) => {
  logger.debug('Initiating data feed updates');

  const providerSponsorDataFeedsGroups = groupDataFeedsByProviderSponsor();

  if (isEmpty(providerSponsorDataFeedsGroups)) {
    logger.error('No data feed for processing found. Stopping.');
    process.exit(NO_DATA_FEEDS_EXIT_CODE);
  }

  let callData:{to:string, data:string}[] = [];
  for (const providerSponsorDataFeed of providerSponsorDataFeedsGroups) {
    const startTimestamp = Date.now();
    let callDataResult = await updateBeacons(providerSponsorDataFeed, startTimestamp, provider);
    callData = callData.concat(callDataResult!);
  }

  if (callData.length > 0) {
    return { canExec: true, callData };
  } else {
    return { canExec: false, message: 'No Beacons to Update' };
  }
};

export const updateDataFeedsInLoop = async (providerSponsorDataFeeds: ProviderSponsorDataFeeds, provider: any) => {
  const startTimestamp = Date.now();

  const callData = await updateBeacons(providerSponsorDataFeeds, startTimestamp, provider);

  return callData;
};

// We pass return value from `prepareGoOptions` (with calculated timeout) to every `go` call in the function to enforce the update cycle.
// This solution is not precise but since chain operations are the only ones that actually take some time this should be a good enough solution.
export const initializeUpdateCycle = async (
  providerSponsorDataFeeds: ProviderSponsorDataFeeds,
  dataFeedType: DataFeedType,
  startTime: number,
  providerw3f: any
) => {

  const { provider, updateInterval, sponsorAddress, beaconTriggers, beaconSetTriggers } = providerSponsorDataFeeds;
  const {  chainId, providerName } = provider;

  const logOptions = {
    meta: {
      'Chain-ID': chainId,
      Provider: providerName,
      Sponsor: shortenAddress(sponsorAddress),
      DataFeedType: dataFeedType,
    },
  };


  if (
    (dataFeedType === DataFeedType.Beacon && isEmpty(beaconTriggers)) ||
    (dataFeedType === DataFeedType.BeaconSet && isEmpty(beaconSetTriggers))
  ) {
    logger.debug(`No ${dataFeedType} found, skipping initialization cycle`);
    return null;
  }

  const { config, beaconValues, sponsorWalletsPrivateKey } = getState();

  // All the beacon updates for given provider & sponsor have up to <updateInterval> seconds to finish
  const totalTimeout = updateInterval * 1_000;

  // Prepare contract for beacon updates
  const contractAddress = config.chains[chainId].contracts['Api3ServerV1'];

  const contract = Api3ServerV1Factory.connect(contractAddress, providerw3f);

  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, providerw3f);

  return {
    contract,
    voidSigner,
    totalTimeout,
    logOptions,
    beaconValues,
    beaconTriggers,
    beaconSetTriggers,
    config,
    provider,
  };
};

// We pass return value from `prepareGoOptions` (with calculated timeout) to every `go` call in the function to enforce the update cycle.
// This solution is not precise but since chain operations are the only ones that actually take some time this should be a good enough solution.
export const updateBeacons = async (
  providerSponsorDataFeeds: ProviderSponsorDataFeeds,
  startTime: number,
  providerw3f: any
) => {
  try {
    const initialUpdateData = await initializeUpdateCycle(
      providerSponsorDataFeeds,
      DataFeedType.Beacon,
      startTime,
      providerw3f
    );
    if (!initialUpdateData) return;
    const { contract, voidSigner, beaconValues, beaconTriggers, config, provider } = initialUpdateData;
    const { chainId } = provider;

    type BeaconUpdate = {
      beaconTrigger: BeaconTrigger;
      beacon: Beacon;
      newBeaconResponse: SignedData;
      newBeaconValue: ethers.BigNumber;
      dataFeedsCalldata: string;
    };

    // Process beacon read calldatas
    const beaconUpdates = beaconTriggers.reduce((acc: BeaconUpdate[], beaconTrigger) => {
      // Check whether we have a value from the provider API for given beacon
      const newBeaconResponse = beaconValues[beaconTrigger.beaconId];

      if (!newBeaconResponse) {
        logger.warn(`No data available for beacon. Skipping.`);
        return acc;
      }

      const newBeaconValue = decodeBeaconValue(newBeaconResponse.encodedValue);

      if (!newBeaconValue) {
        logger.warn(`New beacon value is out of type range. Skipping.`);
        return acc;
      }

      return [
        ...acc,
        {
          beaconTrigger,
          beacon: config.beacons[beaconTrigger.beaconId],
          newBeaconResponse,
          newBeaconValue,
          dataFeedsCalldata: contract.interface.encodeFunctionData('dataFeeds', [beaconTrigger.beaconId]),
        },
      ];
    }, []);
 


    for (const readBatch of chunk(beaconUpdates, DATAFEED_READ_BATCH_SIZE)) {
   
      // Read beacon batch onchain values
      const goDatafeedsTryMulticall = await go(() =>
        contract
          .connect(voidSigner)
          .callStatic.tryMulticall(readBatch.map((beaconUpdate) => beaconUpdate.dataFeedsCalldata))
      );

      if (!goDatafeedsTryMulticall.success) {
        logger.warn(`Unable to read beacon data using tryMulticall. Error: ${goDatafeedsTryMulticall.error}`);
        continue;
      }

      const { successes, returndata } = goDatafeedsTryMulticall.data as { successes: any; returndata: any };

      // Process beacon update calldatas
      let beaconUpdates: BeaconUpdate[] = [];

      for (let i = 0; i < readBatch.length; i++) {
        const beaconReturndata = returndata[i];
        const beaconUpdateData = readBatch[i];

        if (!successes[i]) {
          logger.warn(`Unable to read data feed. Error: ${beaconReturndata}`);
          continue;
        }

        // Decode on-chain data returned by tryMulticall
        const [onChainDataValue, onChainDataTimestamp] = ethers.utils.defaultAbiCoder.decode(
          ['int224', 'uint32'],
          beaconReturndata
        );


        // Verify all conditions for beacon update are met otherwise skip
        const [log, result] = checkConditions(
          onChainDataValue,
          onChainDataTimestamp,
          parseInt(beaconUpdateData.newBeaconResponse.timestamp, 10),
          beaconUpdateData.beaconTrigger,
          beaconUpdateData.newBeaconValue
        );

        if (!result) {
          continue;
        }

        beaconUpdates = [...beaconUpdates, beaconUpdateData];
      }

      const callData:{to:string, data:string}[] = [];
      for (const updateBatch of chunk(beaconUpdates, DATAFEED_UPDATE_BATCH_SIZE)) {

        const updateBatchBeaconIds = updateBatch.map((beaconUpdate) => beaconUpdate.beaconTrigger.beaconId);
        logger.debug(
          `About to update ${updateBatch.length} beacon(s). Beacon id(s): ${updateBatchBeaconIds.join(
            ', '
          )}`
        );

        for (const beaconUpdate of updateBatch) {
          const { data } = await contract.populateTransaction.updateBeaconWithSignedData(
            beaconUpdate.beacon.airnode,
            beaconUpdate.beacon.templateId,
            beaconUpdate.newBeaconResponse.timestamp,
            beaconUpdate.newBeaconResponse.encodedValue,
            beaconUpdate.newBeaconResponse.signature
          ) ;

          callData.push({
            to: contract.address,
            data:data!,
          });
        }
      }
      return callData;
    }
  } catch (error) {

    console.log(error);
  }
};

// We pass return value from `prepareGoOptions` (with calculated timeout) to every `go` call in the function to enforce the update cycle.
// This solution is not precise but since chain operations are the only ones that actually take some time this should be a good enough solution.
export const updateBeaconSets = async (
  providerSponsorDataFeeds: ProviderSponsorDataFeeds,
  startTime: number,
  providerW3f: any
) => {
  const initialUpdateData = await initializeUpdateCycle(
    providerSponsorDataFeeds,
    DataFeedType.BeaconSet,
    startTime,
    providerW3f
  );
  if (!initialUpdateData) return;
  const { contract, voidSigner, totalTimeout, logOptions, beaconValues, beaconSetTriggers, config, provider } =
    initialUpdateData;
  const { chainId } = provider;

  type BeaconSetUpdateData = {
    beaconSetTrigger: BeaconSetTrigger;
    dataFeedsCalldata: string;
  };

  // Process beacon set read calldatas
  const beaconSetUpdates: BeaconSetUpdateData[] = beaconSetTriggers.map((beaconSetTrigger) => {
    // const logOptionsBeaconSetId = {
    //   ...logOptions,
    //   meta: {
    //     ...logOptions.meta,
    //     'Sponsor-Wallet': shortenAddress(sponsorWallet.address),
    //     'BeaconSet-ID': beaconSetTrigger.beaconSetId,
    //   },
    // };

    logger.debug(`Processing beacon set update`);

    return {
      //logOptionsBeaconSetId,
      beaconSetTrigger,
      dataFeedsCalldata: contract.interface.encodeFunctionData('dataFeeds', [beaconSetTrigger.beaconSetId]),
    };
  });
  // [
  //'0x67a7cfb7924b5d4cb3ec6366ae4302a1ca6aec035594ea3ea48a102d160b50b0c43ebfb5',
  //'0x67a7cfb7bf7ce55d109fd196de2a8bf1515d166c56c9decbe9cb473656bbca30d5743990'
  //]
  for (const readBatch of chunk(beaconSetUpdates, DATAFEED_READ_BATCH_SIZE)) {
    // Read beacon set batch onchain values

  
    const goDatafeedsTryMulticall = await go(
      () => {
        const calldatas = readBatch.map((beaconSetUpdateData) => beaconSetUpdateData.dataFeedsCalldata);
        return contract
          .connect(voidSigner)
          .callStatic.tryMulticall([
            '0x67a7cfb7924b5d4cb3ec6366ae4302a1ca6aec035594ea3ea48a102d160b50b0c43ebfb5',
            '0x67a7cfb7bf7ce55d109fd196de2a8bf1515d166c56c9decbe9cb473656bbca30d5743990',
          ]);
      }
      // {
      //   ...prepareGoOptions(startTime, totalTimeout),
      //   onAttemptError: (goError) =>
      //     logger.warn(`Failed attempt to read beaconSet data using multicall. Error ${goError.error}`, logOptions),
      // }
    );
    if (!goDatafeedsTryMulticall.success) {
      logger.warn(`Unable to read beaconSet data using multicall. Error: ${goDatafeedsTryMulticall.error}`);
      continue;
    }

    const { successes, returndata } = goDatafeedsTryMulticall.data;

    // Process beacon set update calldatas
    let beaconSetUpdateCalldatas: string[][] = [];

    for (let i = 0; i < readBatch.length; i++) {
      const beaconSetReturndata = returndata[i];



      const beaconSetUpdateData = readBatch[i];

      if (!successes[i]) {
        logger.warn(`Unable to read data feed. Error: ${beaconSetReturndata}`);
        continue;
      }

      // Decode on-chain data returned by tryMulticall
      const [onChainBeaconSetValue, onChainBeaconSetTimestamp] = ethers.utils.defaultAbiCoder.decode(
        ['int224', 'uint32'],
        beaconSetReturndata
      );

      const beaconSetBeaconIds = config.beaconSets[beaconSetUpdateData.beaconSetTrigger.beaconSetId];

      // Read beacon onchain values for current beacon set with a single tryMulticall call
      const readDataFeedWithIdCalldatas = beaconSetBeaconIds.map((beaconId: any) =>
        contract.interface.encodeFunctionData('readDataFeedWithId', [beaconId])
      );

      const goReadDataFeedWithIdTryMulticall = await go(
        () => contract.connect(voidSigner).callStatic.tryMulticall(Object.values(readDataFeedWithIdCalldatas))
        // {
        //   ...prepareGoOptions(startTime, totalTimeout),
        //   onAttemptError: (goError) =>
        //     logger.warn(
        //       `Failed attempt to read beacon data using multicall. Error ${goError.error}`,
        //       beaconSetUpdateData.logOptionsBeaconSetId
        //     ),
        // }
      );
      if (!goReadDataFeedWithIdTryMulticall.success) {
        logger.warn(`Unable to read beacon data using multicall. Error: ${goReadDataFeedWithIdTryMulticall.error}`);
        continue;
      }
      const { successes: readDataFeedWithIdSuccesses, returndata: readDataFeedWithIdReturndatas } =
        goReadDataFeedWithIdTryMulticall.data as { successes: any; returndata: any };

      type BeaconSetBeaconUpdateData = {
        // These values are used to calculate the median value and timestamp prior to beacon set condition checks
        beaconSetBeaconValues: {
          value: ethers.BigNumber;
          timestamp: number;
        }[];
        // This array contains all the calldatas for updating beacon values
        updateBeaconWithSignedDataCalldatas: string[];
      };

      // Process each beacon in the current beacon set
      let beaconSetBeaconUpdateData: BeaconSetBeaconUpdateData = {
        beaconSetBeaconValues: [],
        updateBeaconWithSignedDataCalldatas: [],
      };
      let shouldSkipBeaconSetUpdate = false;
      for (let i = 0; i < beaconSetBeaconIds.length; i++) {
        const beaconId = beaconSetBeaconIds[i];

        // Cached API value
        const apiBeaconResponse: SignedData | undefined = beaconValues[beaconId];
        // Onchain beacon data
        const beaconReturndata = readDataFeedWithIdReturndatas[i];

        if (!apiBeaconResponse && !readDataFeedWithIdSuccesses[i]) {
          // There is no API data nor onchain value for current beacon
          // Therefore break this look and set the flag to skip the beacon set update
          logger.warn(`No beacon data. Error: ${beaconReturndata}`);
          shouldSkipBeaconSetUpdate = true;
          break;
        }

        // Decode on-chain beacon returned by tryMulticall
        const [onChainBeaconValue, onChainBeaconTimestamp] = ethers.utils.defaultAbiCoder.decode(
          ['int224', 'uint32'],
          beaconReturndata
        );

        let value = onChainBeaconValue;
        let timestamp = onChainBeaconTimestamp;
        let calldata: undefined | string = undefined;
        if (apiBeaconResponse) {
          // There is a new beacon value in the API response
          const decodedValue = decodeBeaconValue(apiBeaconResponse.encodedValue);
          if (!decodedValue) {
            const message = `New beacon value is out of type range.`;
            logger.warn(message);
            shouldSkipBeaconSetUpdate = true;
            break;
          }

          const { airnode, templateId } = config.beacons[beaconId];

          value = decodedValue;
          timestamp = parseInt(apiBeaconResponse.timestamp, 10);
          calldata = contract.interface.encodeFunctionData('updateBeaconWithSignedData', [
            airnode,
            templateId,
            apiBeaconResponse.timestamp,
            apiBeaconResponse.encodedValue,
            apiBeaconResponse.signature,
          ]);
        }

        beaconSetBeaconUpdateData = {
          beaconSetBeaconValues: [...beaconSetBeaconUpdateData.beaconSetBeaconValues, { value, timestamp }],
          updateBeaconWithSignedDataCalldatas: [
            ...beaconSetBeaconUpdateData.updateBeaconWithSignedDataCalldatas,
            ...(calldata ? [calldata] : []),
          ],
        };
      }
      if (shouldSkipBeaconSetUpdate) {
        logger.warn('Missing beacon data.Skipping.');
        continue;
      }

      // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L163
      const newBeaconSetValue = calculateMedian(
        beaconSetBeaconUpdateData.beaconSetBeaconValues.map((value) => value.value)
      );
      const newBeaconSetTimestamp = calculateMedian(
        beaconSetBeaconUpdateData.beaconSetBeaconValues.map((value) => ethers.BigNumber.from(value.timestamp))
      ).toNumber();

      // Verify all conditions for beacon set update are met otherwise skip
      const [log, result] = checkConditions(
        onChainBeaconSetValue,
        onChainBeaconSetTimestamp,
        newBeaconSetTimestamp,
        beaconSetUpdateData.beaconSetTrigger,
        newBeaconSetValue
      );

      if (!result) {
        continue;
      }

      beaconSetUpdateCalldatas = [
        ...beaconSetUpdateCalldatas,
        [
          ...beaconSetBeaconUpdateData.updateBeaconWithSignedDataCalldatas,
          // All beaconSet beaconIds must be passed in as an array because
          // the contract function derives the beaconSetId based on the beaconIds
          contract.interface.encodeFunctionData('updateBeaconSetWithBeacons', [beaconSetBeaconIds]),
        ],
      ];
    }

    for (const beaconSetUpdateCalldata of beaconSetUpdateCalldatas) {
      const tx = await go(() => contract.tryMulticall(beaconSetUpdateCalldata));
      if (!tx.success) {
        logger.warn(`Unable send beacon set batch update transaction with nonce . Error: ${tx.error}`);
        return;
      }

      logger.info(
        `Beacon set batch update transaction was successfully sent with nonce . Tx hash ${
          (tx.data as { hash: any }).hash
        }.`
      );
    }
  }
};
