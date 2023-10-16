
# API3 Airseeker <<-->> Gelato W3F PoC

## Summary
A Gelato Web3 Functions PoC to update a beacons with signed responses from Airnode's gateway following API3 [airseeker repo](https://github.com/api3dao/airseeker) 

## Description
The Web3 Function follows the follows the same structure as the airseekeer with the exception that the config file does not need to include sponsor/airseeker menemonic as the W3F returns the callData to the published on-chain

<img src="/docs/airseeker-w3f.png" width="300">

Still API3 to clarify the sponsor wallet mechanism to charge the users for the usage.

## Running the W3G locally 

1. Open a terminal and spin a hardhat node
   ```shell
   npx hardhat node --network hardhat
   ```

2. Open a second terminal and deploy the Api3ServerV1 to the local network
  ```shell
   yarn dev:setup-local-node
   ```

  ```
  $ npx hardhat run scripts/setup-local-node.ts
  🚀 Api3ServerV1 address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  ✨  Done in 2.25s.
  ```


3. In the second terminal run the signed gateway server
  ```shell
   yarn dev:api
   ```
  $ ts-node test/server/server.ts
  Server is running at http://localhost:5432
  ```

4. Open a third terminal and run the w3f locally
 ```shell
   yarn w3f:test
   ```

 ```shell  
$ npx w3f test web3-functions/airseeker/index.ts --logs --chain-id=31137
Web3Function building...

Web3Function Build result:
 ✓ Schema: web3-functions/airseeker/schema.json
 ✓ Built file: /Users/javiermac/Documents/GELATO/PoCs/api3-v2/.tmp/index.js
 ✓ File size: 5.81mb
 ✓ Build time: 270.48ms

Web3Function user args validation:
 ✓ currency: ETH
 ✓ oracleAddress: 0xB26a01DF1913A9f1E9CdBAEd240e8A38f724A673

Web3Function running logs:
> Initiating fetching all beacon data
> Fetching beacon data {
>   meta: {
>     "Beacon-ID": "0x924b5d4cb3ec6366ae4302a1ca6aec035594ea3ea48a102d160b50b0c43ebfb5"
>   }
> }
> Using the following signed data response: "{"timestamp":"1697448980","encodedValue":"0x000000000000000000000000000000000000000000000000000000002faf0800","signature":"0x198af5b04dcfb9f0e94219fb8fed27cc7404bdea9162d6600790d868abdc496e73c209725499d5db21a6997ebbf9f4571cab1be5739e43a418d378b740cc851f1c"}" {
>   meta: {
>     "Template-ID": "0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa"
>   }
> }
> Initiating data feed updates
> No data available for beacon. Skipping.
> On chain data timestamp older than heartbeat. Updating without condition check.
> About to update 1 beacon(s). Beacon id(s): 0x924b5d4cb3ec6366ae4302a1ca6aec035594ea3ea48a102d160b50b0c43ebfb5

Web3Function Result:
 ✓ Return value: {
  canExec: true,
  callData: [
    {
      to: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      data: '0x1a0a0b3e000000000000000000000000a30ca71ba54e83127214d3271aea8f5d6bd4daceea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa00000000000000000000000000000000000000000000000000000000652d041400000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000002faf08000000000000000000000000000000000000000000000000000000000000000041198af5b04dcfb9f0e94219fb8fed27cc7404bdea9162d6600790d868abdc496e73c209725499d5db21a6997ebbf9f4571cab1be5739e43a418d378b740cc851f1c00000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

Web3Function Runtime stats:
 ✓ Duration: 1.20s
 ✗ Memory: 150.50mb
 ✓ Storage: 0.03kb
 ✓ Network: 2 req [DL: 0.85kb / UL: 1.27kb]
 ✓ Rpc calls: 1
✨  Done in 2.50s.
