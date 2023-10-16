import { isEmpty, uniq } from 'lodash';


import { getState, updateState } from './state';
import { makeSignedDataGatewayRequests } from './make-request';
import { sleep } from './utils';
import { SignedData } from './validation';
import { NO_FETCH_EXIT_CODE, RANDOM_BACKOFF_MAX_MS, RANDOM_BACKOFF_MIN_MS } from './constants';

export const initiateFetchingBeaconData = async () => {
  console.log('Initiating fetching all beacon data');
  const { config } = getState();

  const beaconIdsToUpdate = uniq([
    ...Object.values(config.triggers.dataFeedUpdates).flatMap((dataFeedUpdatesPerSponsor) => {
      return Object.values(dataFeedUpdatesPerSponsor as { [s: string]: unknown; }).flatMap((dataFeedUpdate) => {
        return [
          ...(dataFeedUpdate as any).beacons.map((b:any) => b.beaconId),
          ...(dataFeedUpdate as any).beaconSets.flatMap((b:any) => config.beaconSets[b.beaconSetId]),
        ];
      });
    }),
  ]);

  if (isEmpty(beaconIdsToUpdate)) {
   console.log('No beacons to fetch data for found. Stopping.');
    process.exit(NO_FETCH_EXIT_CODE);
  }

  const b = await fetchBeaconDataInLoop(beaconIdsToUpdate[0])
};

/**
 * Calling "fetchBeaconData" in a loop every "fetchInterval" seconds until the stop signal has been received.
 *
 * Opted in for while loop approach (instead of recursive scheduling of setTimeout) to make sure "fetchBeaconData" calls
 * do not overlap. We measure the total running time of the "fetchBeaconData" and then wait the remaining time
 * accordingly.
 *
 * It is possible that the gateway is down and that the data fetching will take the full "fetchInterval" duration. In
 * that case we do not want to wait, but start calling the gateway immediately as part of the next fetch cycle.
 */
export const fetchBeaconDataInLoop = async (beaconId: string) => {
  const { config } = getState();
  await fetchBeaconData(beaconId);
  
};

export const fetchBeaconData = async (beaconId: string) => {
  const logOptionsBeaconId = { meta: { 'Beacon-ID': beaconId } };
  console.log('Fetching beacon data', logOptionsBeaconId);
  const { config, gatewaysWithLimiters } = getState();

  const { airnode, templateId, fetchMethod } = config.beacons[beaconId];
  const template = config.templates[templateId];

    const gateways = gatewaysWithLimiters[airnode];
    const goRes = await makeSignedDataGatewayRequests(gateways, { ...template, id: templateId });
 
    const data  = goRes;
    if (data) {
      updateState((state) => ({ ...state, beaconValues: { ...state.beaconValues, [beaconId]: data } }));
    }


   

 
};
