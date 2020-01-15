import { xkeyKthAddress } from "@connext/cf-core";
import { IConnextClient } from "@connext/types";
import { AddressZero, Zero } from "ethers/constants";

import { expect } from "../util";
import { createClient, ETH_AMOUNT_MD, TOKEN_AMOUNT } from "../util";

describe("Collateral", () => {
  let clientA: IConnextClient;

  beforeEach(async () => {
    clientA = await createClient();
  }, 90_000);

  it("happy case: node should collateralize ETH", async () => {
    await clientA.requestCollateral(AddressZero);
    const freeBalance = await clientA.getFreeBalance(AddressZero);

    const nodeFreeBalanceAddress = xkeyKthAddress(clientA.config.nodePublicIdentifier);
    expect(freeBalance[clientA.freeBalanceAddress]).toBeBigNumberEq(Zero);
    expect(freeBalance[nodeFreeBalanceAddress]).toBeBigNumberEq(ETH_AMOUNT_MD);
  });

  it("happy case: node should collateralize tokens", async () => {
    const tokenAddress = clientA.config.contractAddresses.Token;

    await clientA.requestCollateral(tokenAddress);
    const freeBalance = await clientA.getFreeBalance(tokenAddress);

    const nodeFreeBalanceAddress = xkeyKthAddress(clientA.config.nodePublicIdentifier);
    expect(freeBalance[clientA.freeBalanceAddress]).toBeBigNumberEq(Zero);
    expect(freeBalance[nodeFreeBalanceAddress]).toBeBigNumberEq(TOKEN_AMOUNT);
  });
});
