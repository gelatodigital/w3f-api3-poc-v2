import { ethers } from "ethers";
import axios from "axios";
import anyPromise from "promise.any";
import Bottleneck from "bottleneck";
import {
  Gateway,
  SignedData,
  signedDataSchema,
  signedDataSchemaLegacy,
  Template,
} from "./validation";
import {
  GATEWAY_TIMEOUT_MS,
  TOTAL_TIMEOUT_HEADROOM_DEFAULT_MS,
} from "./constants";
import { Id, getState } from "./state";

export const urlJoin = (baseUrl: string, endpointId: string) => {
  if (baseUrl.endsWith("/")) {
    return `${baseUrl}${endpointId}`;
  } else {
    return `${baseUrl}/${endpointId}`;
  }
};

export function signWithTemplateId(
  templateId: string,
  timestamp: string,
  data: string
) {
  const { airseekerWalletPrivateKey } = getState();

  return new ethers.Wallet(airseekerWalletPrivateKey).signMessage(
    ethers.utils.arrayify(
      ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["bytes32", "uint256", "bytes"],
          [templateId, timestamp, data || "0x"]
        )
      )
    )
  );
}

export type GatewayWithLimiter = Gateway & { queue?: Bottleneck };

export const makeSignedDataGatewayRequests = async (
  gateways: GatewayWithLimiter[],
  template: Id<Template>
): Promise<SignedData> => {
  const { endpointId, parameters, id: templateId } = template;
  const logOptionsTemplateId = { meta: { "Template-ID": templateId } };

  // Initiate HTTP request to each of the gateways and resolve with the data (or reject otherwise)
  const requests = gateways.map(async (gateway) => {
    const { apiKey, url, queue } = gateway;

    const fullUrl = urlJoin(url, endpointId);

    let httpCall;
    try {
      httpCall = await axios({
        url: fullUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": apiKey,
        },
        data: { encodedParameters: parameters },
      });

      //return data as {success:boolean, data:any, error:string};
    } catch (error) {
      const message = `Failed to make signed data gateway request for gateway: "${fullUrl}". Error: "${error}"`;
      console.log(message, logOptionsTemplateId);
      throw new Error(message);
    }

    const goRes = httpCall.data;

    let parsed;
    //We try first parsing signed data response prior to v0.8.0
    const parsedLegacy = signedDataSchemaLegacy.safeParse(goRes);
    if (parsedLegacy.success) {
      parsed = {
        data: {
          timestamp: parsedLegacy.data.data.timestamp,
          encodedValue: parsedLegacy.data.data.value,
          signature: parsedLegacy.data.signature,
        },
      };
    } else {
      // If above fails then we try parsing v0.8.0 response
      parsed = signedDataSchema.safeParse(goRes);
      if (!parsed.success) {
        const message = `Failed to parse signed data response for gateway: "${fullUrl}". Error: "${parsed.error}"`;
        console.log(message, logOptionsTemplateId);
        throw new Error(message);
      }
    }

    return { data: parsed.data, success: true };
  });

  // Resolve with the first resolved gateway requests
  const goResult = await anyPromise(requests);
  if (!goResult.success) {
    const message =
      "All gateway requests have failed with an error. No response to be used";
    console.log(message, logOptionsTemplateId);
    throw new Error(message);
  }

  // TODO: It might be nice to gather statistics about what gateway is the data coming from (for statistics)
  console.log(
    `Using the following signed data response: "${JSON.stringify(
      goResult.data
    )}"`,
    logOptionsTemplateId
  );
  return goResult.data;
};
