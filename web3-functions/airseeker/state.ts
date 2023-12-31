import { ethers, utils } from 'ethers';
import Bottleneck from 'bottleneck';
import { uniqBy } from 'lodash';
import { BeaconId, Config, Gateway, LimiterConfig, SignedData } from './validation';
import { GatewayWithLimiter } from './make-request';
import {
  DIRECT_GATEWAY_MAX_CONCURRENCY_DEFAULT,
  DIRECT_GATEWAY_MIN_TIME_DEFAULT_MS,
  GATEWAY_MAX_CONCURRENCY_DEFAULT,
  GATEWAY_MIN_TIME_DEFAULT_MS,
} from './constants';



export type Id<T> = T & {
  id: string;
};

export type BeaconValueStorage = Record<BeaconId, SignedData>;
export type Provider = {
  rpcProvider: any;
  chainId: string;
  providerName: string;
};
// chainId => Provider[]
export type Providers = Record<string, Provider[]>;
// sponsorAddress => sponsorWalletPrivateKey
export type SponsorWalletsPrivateKey = Record<string, string>;

export interface State {
  config: Config;
  stopSignalReceived: boolean;
  beaconValues: BeaconValueStorage;
  providers: Providers;
  airseekerWalletPrivateKey: string;
  sponsorWalletsPrivateKey: SponsorWalletsPrivateKey;
  gatewaysWithLimiters: Record<string, GatewayWithLimiter[]>;
  apiLimiters: Record<string, Bottleneck>;
}

// TODO: Freeze the state in development mode
let state: any;

export const initializeState = (config: any, provider: any) => {
  state = getInitialState(config,provider);
};

/**
 * Generates a random ID used when creating Bottleneck limiters.
 */
// eslint-disable-next-line functional/prefer-tacit
export const getRandomId = () => utils.randomBytes(16).toString();

export const buildGatewayLimiter = (gateways: Gateway[], config?: Config, limiterConfig?: LimiterConfig) =>
  gateways.map((gateway) => ({
    ...(gateway as Gateway),
    queue: new Bottleneck({
      id: getRandomId(),
      maxConcurrent:
        limiterConfig?.maxConcurrent ?? config?.rateLimiting?.maxGatewayConcurrency ?? GATEWAY_MAX_CONCURRENCY_DEFAULT,
      minTime: limiterConfig?.minTime ?? config?.rateLimiting?.minGatewayTime ?? GATEWAY_MIN_TIME_DEFAULT_MS,
    }),
  }));

const getSignedDataGatewayOverrideConfig = (airnodeAddress: string, config?: Config): LimiterConfig | undefined => {
  const signedGatewayOverrides = config?.rateLimiting?.overrides?.signedDataGateways;

  if (!(signedGatewayOverrides && signedGatewayOverrides[airnodeAddress])) {
    return undefined;
  }

  return signedGatewayOverrides[airnodeAddress];
};

export const buildGatewayLimiters = (gateways?: Record<string, Gateway[]>, config?: Config) =>
  gateways
    ? Object.fromEntries(
        Object.entries(gateways).map(([airnodeAddress, gateways]) => [
          airnodeAddress,
          buildGatewayLimiter(gateways, config, getSignedDataGatewayOverrideConfig(airnodeAddress, config)),
        ])
      )
    : {};

const deriveEndpointId = (oisTitle: string, endpointName: string) =>
  ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['string', 'string'], [oisTitle, endpointName]));

export const buildApiLimiters = (config: Config) => {
  if (!config.ois) {
    return {};
  }

  const oisLimiters = Object.fromEntries(
    config.ois.map((ois) => {
      const directGatewayOverrides = config?.rateLimiting?.overrides?.directGateways;

      if (directGatewayOverrides && directGatewayOverrides[ois.title]) {
        const { minTime, maxConcurrent } = directGatewayOverrides[ois.title];

        return [
          ois.title,
          new Bottleneck({
            id: getRandomId(),
            minTime: minTime ?? DIRECT_GATEWAY_MIN_TIME_DEFAULT_MS,
            maxConcurrent: maxConcurrent ?? DIRECT_GATEWAY_MAX_CONCURRENCY_DEFAULT,
          }),
        ];
      }

      return [
        ois.title,
        new Bottleneck({
          id: getRandomId(),
          minTime: DIRECT_GATEWAY_MIN_TIME_DEFAULT_MS,
          maxConcurrent: DIRECT_GATEWAY_MAX_CONCURRENCY_DEFAULT,
        }),
      ];
    })
  );
  const endpointTitles = Object.fromEntries(
    config.ois.flatMap((ois) =>
      ois.endpoints.map((endpoint) => [deriveEndpointId(ois.title, endpoint.name), ois.title])
    )
  );

  // Make use of the reference/pointer nature of objects
  const apiLimiters = Object.fromEntries(
    Object.entries(config.templates).map(([templateId, template]) => {
      const title = endpointTitles[template.endpointId];
      return [templateId, oisLimiters[title]];
    })
  );

  return apiLimiters;
};

export const getInitialState = (config: Config, provider:any) => {
  // Set initial log options
  // setLogOptions({
  //   ...config.log,
  //   meta: { 'Coordinator-ID': randomHexString(16) },
  // });

  return {
    config,
    stopSignalReceived: false,
    beaconValues: {},
    providers: { 
      '31337': [
      {
        rpcProvider: [provider],
        chainId: '31337',
        providerName: 'local'
      }
    ]},
    gatewaysWithLimiters: buildGatewayLimiters(config.gateways),
    apiLimiters: buildApiLimiters(config),
    airseekerWalletPrivateKey: '',
    sponsorWalletsPrivateKey: {},
  };
};

type StateUpdater = (state: State) => State;
export const updateState = (updater: StateUpdater) => {
  setState(updater(state));

};


export const setState = (newState: State) => {
  state = newState;
};

export const getState = () => {
  return state;
};
