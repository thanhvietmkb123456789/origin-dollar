const { expect } = require("chai");
const { formatUnits, parseUnits } = require("ethers/lib/utils");
const { run } = require("hardhat");

const addresses = require("../../utils/addresses");
const { convex_OETH_ETH_PID } = require("../../utils/constants");
const { units, oethUnits, isCI } = require("../helpers");
const {
  createFixtureLoader,
  convexOethEthAmoFixture,
} = require("../fixture/_fixture");

const log = require("../../utils/logger")("test:fork:oeth:amo:curve");

describe("ForkTest: OETH AMO Curve Strategy", function () {
  this.timeout(0);
  // Retry up to 3 times on CI
  this.retries(isCI ? 3 : 0);

  let fixture;

  describe("with mainnet data", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture);
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Should have constants and immutables set", async () => {
      const { convexEthMetaStrategy } = fixture;

      expect(await convexEthMetaStrategy.MAX_SLIPPAGE()).to.equal(
        parseUnits("0.01", 18)
      );
      expect(await convexEthMetaStrategy.cvxDepositorAddress()).to.equal(
        addresses.mainnet.CVXBooster
      );
      expect(await convexEthMetaStrategy.cvxRewardStaker()).to.equal(
        addresses.mainnet.CVXETHRewardsPool
      );
      expect(await convexEthMetaStrategy.cvxDepositorPTokenId()).to.equal(
        convex_OETH_ETH_PID
      );
      expect(await convexEthMetaStrategy.curvePool()).to.equal(
        addresses.mainnet.CurveOETHMetaPool
      );
      expect(await convexEthMetaStrategy.lpToken()).to.equal(
        addresses.mainnet.CurveOETHMetaPool
      );
      expect(await convexEthMetaStrategy.oeth()).to.equal(
        addresses.mainnet.OETHProxy
      );
      expect(await convexEthMetaStrategy.weth()).to.equal(
        addresses.mainnet.WETH
      );
    });
    it("Should have AMO strategy configured in the vault", async () => {
      const { oethVault } = fixture;

      const config = await oethVault.getStrategyConfig(
        addresses.mainnet.ConvexOETHAMOStrategy
      );
      expect(config.isSupported).to.be.true;
      expect(config.isAMO).to.be.true;
      expect(config.mintForStrategy).to.eq(0);
      expect(config.mintForStrategyThreshold).to.be.eq(parseUnits("500", 21));
    });
    it("Should be able to check balance", async () => {
      const { weth, josh, convexEthMetaStrategy } = fixture;

      const balance = await convexEthMetaStrategy.checkBalance(weth.address);
      log(`check balance ${balance}`);
      expect(balance).gt(0);

      // This uses a transaction to call a view function so the gas usage can be reported.
      const tx = await convexEthMetaStrategy
        .connect(josh)
        .populateTransaction.checkBalance(weth.address);
      await josh.sendTransaction(tx);
    });
    it("Should be able to harvest the rewards", async function () {
      const {
        josh,
        weth,
        oethHarvester,
        oethDripper,
        oethVault,
        convexEthMetaStrategy,
        crv,
      } = fixture;

      // send some CRV to the strategy to partly simulate reward harvesting
      await crv
        .connect(josh)
        .transfer(convexEthMetaStrategy.address, parseUnits("1000"));

      const wethBefore = await weth.balanceOf(oethDripper.address);

      // prettier-ignore
      await oethHarvester
        .connect(josh)["harvestAndSwap(address)"](convexEthMetaStrategy.address);

      const wethDiff = (await weth.balanceOf(oethDripper.address)).sub(
        wethBefore
      );
      await oethVault.connect(josh).rebase();

      await expect(wethDiff).to.be.gte(parseUnits("0.15"));
    });
    it("Only Governor can approve all tokens", async () => {
      const {
        timelock,
        strategist,
        josh,
        oethVaultSigner,
        convexEthMetaStrategy,
        weth,
        oeth,
        curveOethEthPool,
      } = fixture;

      // Governor can approve all tokens
      const tx = await convexEthMetaStrategy
        .connect(timelock)
        .safeApproveAllTokens();
      await expect(tx).to.not.emit(weth, "Approval");
      await expect(tx).to.emit(oeth, "Approval");
      await expect(tx).to.emit(curveOethEthPool, "Approval");

      for (const signer of [strategist, josh, oethVaultSigner]) {
        const tx = convexEthMetaStrategy.connect(signer).safeApproveAllTokens();
        await expect(tx).to.be.revertedWith("Caller is not the Governor");
      }
    });
  });

  describe("with some WETH in the vault", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: false,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Vault should deposit some WETH to AMO strategy", async function () {
      const {
        convexEthMetaStrategy,
        oeth,
        curveOethEthPool,
        oethVaultSigner,
        weth,
      } = fixture;

      const wethDepositAmount = await units("5000", weth);

      // Vault transfers WETH to strategy
      await weth
        .connect(oethVaultSigner)
        .transfer(convexEthMetaStrategy.address, wethDepositAmount);

      const { oethMintAmount, curveBalances: curveBalancesBefore } =
        await calcOethMintAmount(fixture, wethDepositAmount);
      const oethSupplyBefore = await oeth.totalSupply();

      log("Before deposit to strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
      });

      // prettier-ignore
      const tx = await convexEthMetaStrategy
        .connect(oethVaultSigner)["deposit(address,uint256)"](weth.address, wethDepositAmount);

      const receipt = await tx.wait();

      log("After deposit to strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
        fromBlock: receipt.blockNumber - 1,
      });

      // Check emitted events
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Deposit")
        .withArgs(weth.address, curveOethEthPool.address, wethDepositAmount);
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Deposit")
        .withArgs(oeth.address, curveOethEthPool.address, oethMintAmount);

      // Check the ETH and OETH balances in the Curve pool
      const curveBalancesAfter = await curveOethEthPool.get_balances();
      expect(curveBalancesAfter[0]).to.approxEqualTolerance(
        curveBalancesBefore[0].add(wethDepositAmount),
        0.01 // 0.01% or 1 basis point
      );
      expect(curveBalancesAfter[1]).to.approxEqualTolerance(
        curveBalancesBefore[1].add(oethMintAmount),
        0.01 // 0.01% or 1 basis point
      );

      // Check the OETH total supply increase
      const oethSupplyAfter = await oeth.totalSupply();
      expect(oethSupplyAfter).to.approxEqualTolerance(
        oethSupplyBefore.add(oethMintAmount),
        0.01 // 0.01% or 1 basis point
      );
    });
    it("Only vault can deposit some WETH to AMO strategy", async function () {
      const {
        convexEthMetaStrategy,
        oethVaultSigner,
        strategist,
        timelock,
        josh,
        weth,
      } = fixture;

      const depositAmount = parseUnits("50");
      await weth
        .connect(oethVaultSigner)
        .transfer(convexEthMetaStrategy.address, depositAmount);

      for (const signer of [strategist, timelock, josh]) {
        // prettier-ignore
        const tx = convexEthMetaStrategy
          .connect(signer)["deposit(address,uint256)"](weth.address, depositAmount);

        await expect(tx).to.revertedWith("Caller is not the Vault");
      }
    });
    it("Only vault can deposit all WETH to AMO strategy", async function () {
      const {
        convexEthMetaStrategy,
        curveOethEthPool,
        oethVaultSigner,
        strategist,
        timelock,
        josh,
        weth,
      } = fixture;

      const depositAmount = parseUnits("50");
      await weth
        .connect(oethVaultSigner)
        .transfer(convexEthMetaStrategy.address, depositAmount);

      for (const signer of [strategist, timelock, josh]) {
        const tx = convexEthMetaStrategy.connect(signer).depositAll();

        await expect(tx).to.revertedWith("Caller is not the Vault");
      }

      const tx = await convexEthMetaStrategy
        .connect(oethVaultSigner)
        .depositAll();
      await expect(tx).to.emit(convexEthMetaStrategy, "Deposit").withNamedArgs({
        _asset: weth.address,
        _pToken: curveOethEthPool.address,
      });
    });
  });

  describe("with the strategy having some OETH and ETH in the Curve pool", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: true,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Vault should be able to withdraw all", async () => {
      const {
        convexEthMetaStrategy,
        curveOethEthPool,
        oeth,
        oethVaultSigner,
        weth,
      } = fixture;

      const {
        oethBurnAmount,
        ethWithdrawAmount,
        curveBalances: curveBalancesBefore,
      } = await calcWithdrawAllAmounts(fixture);

      const oethSupplyBefore = await oeth.totalSupply();

      log("Before withdraw all from strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
      });

      // Now try to withdraw all the WETH from the strategy
      const tx = await convexEthMetaStrategy
        .connect(oethVaultSigner)
        .withdrawAll();

      const receipt = await tx.wait();

      log("After withdraw all from strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
        fromBlock: receipt.blockNumber - 1,
      });

      // Check emitted events
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Withdrawal")
        .withArgs(weth.address, curveOethEthPool.address, ethWithdrawAmount);
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Withdrawal")
        .withArgs(oeth.address, curveOethEthPool.address, oethBurnAmount);

      // Check the ETH and OETH balances in the Curve pool
      const curveBalancesAfter = await curveOethEthPool.get_balances();
      expect(curveBalancesAfter[0]).to.approxEqualTolerance(
        curveBalancesBefore[0].sub(ethWithdrawAmount),
        0.01 // 0.01% or 1 basis point
      );
      expect(curveBalancesAfter[1]).to.approxEqualTolerance(
        curveBalancesBefore[1].sub(oethBurnAmount),
        0.01 // 0.01%
      );

      // Check the OETH total supply decrease
      const oethSupplyAfter = await oeth.totalSupply();
      expect(oethSupplyAfter).to.approxEqualTolerance(
        oethSupplyBefore.sub(oethBurnAmount),
        0.01 // 0.01% or 1 basis point
      );
    });
    it("Vault should be able to withdraw some", async () => {
      const {
        convexEthMetaStrategy,
        oeth,
        curveOethEthPool,
        oethVault,
        oethVaultSigner,
        weth,
      } = fixture;

      const withdrawAmount = oethUnits("1000");

      const { oethBurnAmount, curveBalances: curveBalancesBefore } =
        await calcOethWithdrawAmount(fixture, withdrawAmount);
      const oethSupplyBefore = await oeth.totalSupply();
      const vaultWethBalanceBefore = await weth.balanceOf(oethVault.address);

      log("Before withdraw from strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
      });

      // Now try to withdraw the WETH from the strategy
      // prettier-ignore
      const tx = await convexEthMetaStrategy
        .connect(oethVaultSigner)["withdraw(address,address,uint256)"](
          oethVault.address,
          weth.address,
          withdrawAmount
        );

      const receipt = await tx.wait();

      log("After withdraw from strategy");
      await run("amoStrat", {
        pool: "OETH",
        output: false,
        fromBlock: receipt.blockNumber - 1,
      });

      // Check emitted events
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Withdrawal")
        .withArgs(weth.address, curveOethEthPool.address, withdrawAmount);
      await expect(tx)
        .to.emit(convexEthMetaStrategy, "Withdrawal")
        .withNamedArgs({
          _asset: oeth.address,
          _pToken: curveOethEthPool.address,
        });

      // Check the ETH and OETH balances in the Curve pool
      const curveBalancesAfter = await curveOethEthPool.get_balances();
      expect(curveBalancesAfter[0]).to.approxEqualTolerance(
        curveBalancesBefore[0].sub(withdrawAmount),
        0.01 // 0.01% or 1 basis point
      );
      expect(curveBalancesAfter[1]).to.approxEqualTolerance(
        curveBalancesBefore[1].sub(oethBurnAmount),
        0.01 // 0.01%
      );

      // Check the OETH total supply decrease
      const oethSupplyAfter = await oeth.totalSupply();
      expect(oethSupplyAfter).to.approxEqualTolerance(
        oethSupplyBefore.sub(oethBurnAmount),
        0.01 // 0.01% or 1 basis point
      );

      // Check the WETH balance in the Vault
      expect(await weth.balanceOf(oethVault.address)).to.equal(
        vaultWethBalanceBefore.add(withdrawAmount)
      );
    });
    it("Only vault can withdraw some WETH from AMO strategy", async function () {
      const {
        convexEthMetaStrategy,
        oethVault,
        strategist,
        timelock,
        josh,
        weth,
      } = fixture;

      for (const signer of [strategist, timelock, josh]) {
        // prettier-ignore
        const tx = convexEthMetaStrategy
          .connect(signer)["withdraw(address,address,uint256)"](
            oethVault.address,
            weth.address,
            parseUnits("50")
          );

        await expect(tx).to.revertedWith("Caller is not the Vault");
      }
    });
    it("Only vault and governor can withdraw all WETH from AMO strategy", async function () {
      const { convexEthMetaStrategy, strategist, timelock, josh } = fixture;

      for (const signer of [strategist, josh]) {
        const tx = convexEthMetaStrategy.connect(signer).withdrawAll();

        await expect(tx).to.revertedWith("Caller is not the Vault or Governor");
      }

      // Governor can withdraw all
      const tx = convexEthMetaStrategy.connect(timelock).withdrawAll();
      await expect(tx).to.emit(convexEthMetaStrategy, "Withdrawal");
    });
  });

  describe("with a lot more OETH in the Curve pool", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: false,
      poolAddOethAmount: 4000,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Strategist should remove a little OETH from the Curve pool", async () => {
      await assertRemoveAndBurn(parseUnits("3"), fixture);
    });
    it("Strategist should remove a lot of OETH from the Curve pool", async () => {
      await assertRemoveAndBurn(parseUnits("3500"), fixture);
    });
    it("Strategist should fail to add even more OETH to the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      // Mint and add OETH to the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .mintAndAddOTokens(parseUnits("1"));

      await expect(tx).to.be.revertedWith("OTokens balance worse");
    });
    it("Strategist should fail to remove the little ETH from the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      // Remove ETH form the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .removeOnlyAssets(parseUnits("1"));

      await expect(tx).to.be.revertedWith("OTokens balance worse");
    });
  });

  describe("with a lot more ETH in the Curve pool", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: false,
      poolAddEthAmount: 200000,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Strategist should add a little OETH to the Curve pool", async () => {
      const oethMintAmount = oethUnits("3");
      await assertMintAndAddOTokens(oethMintAmount, fixture);
    });
    it("Strategist should add a lot of OETH to the Curve pool", async () => {
      const oethMintAmount = oethUnits("150000");
      await assertMintAndAddOTokens(oethMintAmount, fixture);
    });
    it("Strategist should add OETH to balance the Curve pool", async () => {
      const { curveOethEthPool } = fixture;
      const curveBalances = await curveOethEthPool.get_balances();
      const oethMintAmount = curveBalances[0]
        .sub(curveBalances[1])
        // reduce by 0.001%
        .mul(99999)
        .div(100000);

      await assertMintAndAddOTokens(oethMintAmount, fixture);
    });
    it("Strategist should remove a little ETH from the Curve pool", async () => {
      const lpAmount = parseUnits("2");
      await assertRemoveOnlyAssets(lpAmount, fixture);
    });
    it("Strategist should remove a lot ETH from the Curve pool", async () => {
      const lpAmount = parseUnits("5000");
      await assertRemoveOnlyAssets(lpAmount, fixture);
    });
  });

  describe("with a little more ETH in the Curve pool", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: false,
      poolAddEthAmount: 8000,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Strategist should remove ETH to balance the Curve pool", async () => {
      const { curveOethEthPool } = fixture;
      const curveBalances = await curveOethEthPool.get_balances();
      const lpAmount = curveBalances[0]
        .sub(curveBalances[1])
        // reduce by 1%
        .mul(99)
        .div(100);
      expect(lpAmount).to.be.gt(0);

      await assertRemoveOnlyAssets(lpAmount, fixture);
    });
    it("Strategist should fail to add too much OETH to the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      const oethAmount = parseUnits("7000");
      log(
        `Before mint of ${formatUnits(
          oethAmount
        )} OETH and add to the Curve pool`
      );
      await run("amoStrat", {
        pool: "OETH",
        output: false,
      });

      // Add OETH to the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .mintAndAddOTokens(oethAmount);

      await expect(tx).to.be.revertedWith("Assets overshot peg");
    });
    it("Strategist should fail to remove too much ETH from the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      // Remove ETH from the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .removeOnlyAssets(parseUnits("8000"));

      await expect(tx).to.be.revertedWith("Assets overshot peg");
    });
    it("Strategist should fail to remove the little OETH from the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      // Remove ETH from the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .removeAndBurnOTokens(parseUnits("1"));

      await expect(tx).to.be.revertedWith("Assets balance worse");
    });
  });

  describe("with a little more OETH in the Curve pool", () => {
    const loadFixture = createFixtureLoader(convexOethEthAmoFixture, {
      wethMintAmount: 5000,
      depositToStrategy: false,
      poolAddOethAmount: 500,
    });
    beforeEach(async () => {
      fixture = await loadFixture();
    });
    it("Strategist should fail to remove too much OETH from the Curve pool", async () => {
      const { convexEthMetaStrategy, strategist } = fixture;

      // Remove OETH from the Curve pool
      const tx = convexEthMetaStrategy
        .connect(strategist)
        .removeAndBurnOTokens(parseUnits("4000"));

      await expect(tx).to.be.revertedWith("OTokens overshot peg");
    });
  });
});

async function assertRemoveAndBurn(lpAmount, fixture) {
  const { convexEthMetaStrategy, curveOethEthPool, oeth, strategist } = fixture;

  const oethBurnAmount = await calcOethRemoveAmount(fixture, lpAmount);
  const curveBalancesBefore = await curveOethEthPool.get_balances();
  const oethSupplyBefore = await oeth.totalSupply();

  log(
    `Before remove and burn of ${formatUnits(
      lpAmount
    )} OETH from the Curve pool`
  );
  await run("amoStrat", {
    pool: "OETH",
    output: false,
  });

  // Remove and burn OETH from the Curve pool
  const tx = await convexEthMetaStrategy
    .connect(strategist)
    .removeAndBurnOTokens(lpAmount);

  const receipt = await tx.wait();

  log("After remove and burn of OETH from Curve pool");
  await run("amoStrat", {
    pool: "OETH",
    output: false,
    fromBlock: receipt.blockNumber - 1,
  });

  // Check emitted event
  await expect(tx)
    .to.emit(convexEthMetaStrategy, "Withdrawal")
    .withArgs(oeth.address, curveOethEthPool.address, oethBurnAmount);

  // Check the ETH and OETH balances in the Curve pool
  const curveBalancesAfter = await curveOethEthPool.get_balances();
  expect(curveBalancesAfter[0]).to.equal(curveBalancesBefore[0]);
  expect(curveBalancesAfter[1]).to.approxEqualTolerance(
    curveBalancesBefore[1].sub(oethBurnAmount),
    0.01 // 0.01%
  );

  // Check the OETH total supply decrease
  const oethSupplyAfter = await oeth.totalSupply();
  expect(oethSupplyAfter).to.approxEqualTolerance(
    oethSupplyBefore.sub(oethBurnAmount),
    0.01 // 0.01% or 1 basis point
  );
}

async function assertMintAndAddOTokens(oethMintAmount, fixture) {
  const { convexEthMetaStrategy, curveOethEthPool, oeth, strategist } = fixture;

  const curveBalancesBefore = await curveOethEthPool.get_balances();
  const oethSupplyBefore = await oeth.totalSupply();

  log(
    `Before mint and add ${formatUnits(oethMintAmount)} OETH to the Curve pool`
  );
  await run("amoStrat", {
    pool: "OETH",
    output: false,
  });

  // Mint and add OETH to the Curve pool
  const tx = await convexEthMetaStrategy
    .connect(strategist)
    .mintAndAddOTokens(oethMintAmount);

  const receipt = await tx.wait();

  // Check emitted event
  await expect(tx)
    .emit(convexEthMetaStrategy, "Deposit")
    .withArgs(oeth.address, curveOethEthPool.address, oethMintAmount);

  log("After mint and add of OETH to the Curve pool");
  await run("amoStrat", {
    pool: "OETH",
    output: false,
    fromBlock: receipt.blockNumber - 1,
  });

  // Check the ETH and OETH balances in the Curve pool
  const curveBalancesAfter = await curveOethEthPool.get_balances();
  expect(curveBalancesAfter[0]).to.approxEqualTolerance(
    curveBalancesBefore[0],
    0.01 // 0.01% or 1 basis point
  );
  expect(curveBalancesAfter[1]).to.approxEqualTolerance(
    curveBalancesBefore[1].add(oethMintAmount),
    0.01 // 0.01%
  );

  // Check the OETH total supply decrease
  const oethSupplyAfter = await oeth.totalSupply();
  expect(oethSupplyAfter).to.approxEqualTolerance(
    oethSupplyBefore.add(oethMintAmount),
    0.01 // 0.01% or 1 basis point
  );
}

async function assertRemoveOnlyAssets(lpAmount, fixture) {
  const {
    convexEthMetaStrategy,
    convexOethEthRewardsPool,
    curveOethEthPool,
    oethVault,
    oeth,
    strategist,
    weth,
  } = fixture;

  log(`Removing ${formatUnits(lpAmount)} ETH from the Curve pool`);
  const ethRemoveAmount = await calcEthRemoveAmount(fixture, lpAmount);
  log("After calc ETH remove amount");
  const curveBalancesBefore = await curveOethEthPool.get_balances();
  const oethSupplyBefore = await oeth.totalSupply();
  const vaultWethBalanceBefore = await weth.balanceOf(oethVault.address);
  const strategyLpBalanceBefore = await convexOethEthRewardsPool.balanceOf(
    convexEthMetaStrategy.address
  );
  const vaultValueBefore = await oethVault.totalValue();

  log(
    `Before remove and burn of ${formatUnits(lpAmount)} ETH from the Curve pool`
  );
  await run("amoStrat", {
    pool: "OETH",
    output: false,
  });

  // Remove ETH from the Curve pool and transfer to the Vault as WETH
  const tx = await convexEthMetaStrategy
    .connect(strategist)
    .removeOnlyAssets(lpAmount);

  const receipt = await tx.wait();

  log("After remove and burn of ETH from Curve pool");
  await run("amoStrat", {
    pool: "OETH",
    output: false,
    fromBlock: receipt.blockNumber - 1,
  });

  // Check emitted event
  await expect(tx)
    .to.emit(convexEthMetaStrategy, "Withdrawal")
    .withArgs(weth.address, curveOethEthPool.address, ethRemoveAmount);

  // Check the ETH and OETH balances in the Curve pool
  const curveBalancesAfter = await curveOethEthPool.get_balances();
  expect(curveBalancesAfter[0]).to.approxEqualTolerance(
    curveBalancesBefore[0].sub(ethRemoveAmount),
    0.01 // 0.01% or 1 basis point
  );
  expect(curveBalancesAfter[1]).to.equal(curveBalancesBefore[1]);

  // Check the OETH total supply is the same
  const oethSupplyAfter = await oeth.totalSupply();
  expect(oethSupplyAfter).to.approxEqualTolerance(
    oethSupplyBefore,
    0.01 // 0.01% or 1 basis point
  );

  // Check the WETH balance in the Vault
  expect(await weth.balanceOf(oethVault.address)).to.equal(
    vaultWethBalanceBefore.add(ethRemoveAmount)
  );

  // Check the vault made money
  const vaultValueAfter = await oethVault.totalValue();
  expect(vaultValueAfter.sub(vaultValueBefore)).to.gt(parseUnits("-1"));

  // Check the strategy LP balance decreased
  const strategyLpBalanceAfter = await convexOethEthRewardsPool.balanceOf(
    convexEthMetaStrategy.address
  );
  expect(strategyLpBalanceBefore.sub(strategyLpBalanceAfter)).to.eq(lpAmount);
}

// Calculate the minted OETH amount for a deposit
async function calcOethMintAmount(fixture, wethDepositAmount) {
  const { curveOethEthPool } = fixture;

  // Get the ETH and OETH balances in the Curve pool
  const curveBalances = await curveOethEthPool.get_balances();
  // ETH balance - OETH balance
  const balanceDiff = curveBalances[0].sub(curveBalances[1]);

  let oethMintAmount = balanceDiff.lte(0)
    ? // If more OETH than ETH then mint same amount of OETH as ETH
      wethDepositAmount
    : // If less OETH than ETH then mint the difference
      balanceDiff.add(wethDepositAmount);
  // Cap the minting to twice the ETH deposit amount
  const doubleWethDepositAmount = wethDepositAmount.mul(2);
  oethMintAmount = oethMintAmount.lte(doubleWethDepositAmount)
    ? oethMintAmount
    : doubleWethDepositAmount;
  log(`OETH mint amount : ${formatUnits(oethMintAmount)}`);

  return { oethMintAmount, curveBalances };
}

// Calculate the amount of OETH burnt from a withdraw
async function calcOethWithdrawAmount(fixture, wethWithdrawAmount) {
  const { curveOethEthPool } = fixture;

  // Get the ETH and OETH balances in the Curve pool
  const curveBalances = await curveOethEthPool.get_balances();

  // OETH to burn = WETH withdrawn * OETH pool balance / ETH pool balance
  const oethBurnAmount = wethWithdrawAmount
    .mul(curveBalances[1])
    .div(curveBalances[0]);

  log(`OETH burn amount : ${formatUnits(oethBurnAmount)}`);

  return { oethBurnAmount, curveBalances };
}

// Calculate the OETH and ETH amounts from a withdrawAll
async function calcWithdrawAllAmounts(fixture) {
  const { convexEthMetaStrategy, convexOethEthRewardsPool, curveOethEthPool } =
    fixture;

  // Get the ETH and OETH balances in the Curve pool
  const curveBalances = await curveOethEthPool.get_balances();
  const strategyLpAmount = await convexOethEthRewardsPool.balanceOf(
    convexEthMetaStrategy.address
  );
  const totalLpSupply = await curveOethEthPool.totalSupply();

  // OETH to burn = OETH pool balance * strategy LP amount / total pool LP amount
  const oethBurnAmount = curveBalances[1]
    .mul(strategyLpAmount)
    .div(totalLpSupply);
  // ETH to withdraw = ETH pool balance * strategy LP amount / total pool LP amount
  const ethWithdrawAmount = curveBalances[0]
    .mul(strategyLpAmount)
    .div(totalLpSupply);

  log(`OETH burn amount    : ${formatUnits(oethBurnAmount)}`);
  log(`ETH withdraw amount : ${formatUnits(ethWithdrawAmount)}`);

  return { oethBurnAmount, ethWithdrawAmount, curveBalances };
}

// Calculate the amount of OETH burned from a removeAndBurnOTokens
async function calcOethRemoveAmount(fixture, lpAmount) {
  const { curveOethEthGaugeSigner, curveOethEthPool } = fixture;

  // Static call to get the OETH removed from the Curve pool for a given amount of LP tokens
  const oethBurnAmount = await curveOethEthPool
    .connect(curveOethEthGaugeSigner)
    .callStatic["remove_liquidity_one_coin(uint256,int128,uint256)"](
      lpAmount,
      1,
      0
    );

  log(`OETH burn amount : ${formatUnits(oethBurnAmount)}`);

  return oethBurnAmount;
}

// Calculate the amount of ETH burned from a removeOnlyAssets
async function calcEthRemoveAmount(fixture, lpAmount) {
  const { curveOethEthPool } = fixture;

  // Get the ETH removed from the Curve pool for a given amount of LP tokens
  const ethRemoveAmount = await curveOethEthPool.calc_withdraw_one_coin(
    lpAmount,
    0
  );

  log(`ETH burn amount : ${formatUnits(ethRemoveAmount)}`);

  return ethRemoveAmount;
}