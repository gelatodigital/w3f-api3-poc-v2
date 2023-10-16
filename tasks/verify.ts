import { task } from "hardhat/config";

export const verify = task("etherscan-verify", "verify").setAction(
  async ({}, hre) => {
    await hre.run("verify:verify", {
      address: "0xB26a01DF1913A9f1E9CdBAEd240e8A38f724A673e",
      constructorArguments: [],
    });
  }
);
