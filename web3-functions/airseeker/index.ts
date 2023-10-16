import {
  Web3Function,
  Web3FunctionContext,
  Web3FunctionResult,
} from "@gelatonetwork/web3-functions-sdk";
import { Api3ServerV1__factory as Api3ServerV1Factory } from '@api3/airnode-protocol-v1';

import { initiateFetchingBeaconData } from "./fetch-beacon-data";

import {configObj} from './airseeker.json'
import { getState, initializeState } from "./state";
import { initiateDataFeedUpdates } from "./update-data-feeds";
import { ethers } from "ethers";


Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.chainId(31337);

  initializeState(configObj, provider);

  await initiateFetchingBeaconData();

  let result  =await initiateDataFeedUpdates(provider) as Web3FunctionResult

  return result


});
