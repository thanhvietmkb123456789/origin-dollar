const { expect } = require("chai");
const { parseUnits } = require("ethers/lib/utils");

const addresses = require("../../utils/addresses");
const {
  createFixtureLoader,
  oethDefaultFixture,
  oethCollateralSwapFixture,
  impersonateAccount,
} = require("../_fixture");
const { forkOnlyDescribe, isCI } = require("../helpers");

const { oethWhaleAddress } = addresses.mainnet;

forkOnlyDescribe("ForkTest: OETH Vault", function () {
  this.timeout(0);

  // Retry up to 3 times on CI
  this.retries(isCI ? 3 : 0);

  let fixture;

  describe("OETH Vault", () => {
    describe("post deployment", () => {
      const loadFixture = createFixtureLoader(oethDefaultFixture);
      beforeEach(async () => {
        fixture = await loadFixture();
      });

      it("Should have the correct governor address set", async () => {
        const {
          oethVault,
          oethDripper,
          convexEthMetaStrategy,
          fraxEthStrategy,
          oeth,
          woeth,
          oethHarvester,
        } = fixture;

        const oethContracts = [
          oethVault,
          oethDripper,
          convexEthMetaStrategy,
          fraxEthStrategy,
          oeth,
          woeth,
          oethHarvester,
        ];

        for (let i = 0; i < oethContracts.length; i++) {
          expect(await oethContracts[i].governor()).to.equal(
            addresses.mainnet.Timelock
          );
        }
      });
    });
    describe("user operations", () => {
      let oethWhaleSigner;
      const loadFixture = createFixtureLoader(oethCollateralSwapFixture);
      beforeEach(async () => {
        fixture = await loadFixture();

        await impersonateAccount(oethWhaleAddress);
        oethWhaleSigner = await ethers.provider.getSigner(oethWhaleAddress);
      });

      it("should mint using each asset", async () => {
        const { oethVault, weth, frxETH, stETH, reth, josh } = fixture;

        const amount = parseUnits("1", 18);
        const minOeth = parseUnits("0.8", 18);

        for (const asset of [weth, frxETH, stETH, reth]) {
          await asset.connect(josh).approve(oethVault.address, amount);
          const tx = await oethVault
            .connect(josh)
            .mint(asset.address, amount, minOeth);

          if (asset === weth || asset === frxETH) {
            await expect(tx)
              .to.emit(oethVault, "Mint")
              .withArgs(josh.address, amount);
          } else {
            // Oracle price means 1 asset != 1 OETH
            await expect(tx)
              .to.emit(oethVault, "Mint")
              .withNamedArgs({ _addr: josh.address });
          }
        }
      });
      it("should partially redeem", async () => {
        const { oeth, oethVault, matt } = fixture;

        expect(await oeth.balanceOf(matt.address)).to.gt(10);

        const amount = parseUnits("10", 18);
        const minEth = parseUnits("9.94", 18);

        const tx = await oethVault.connect(matt).redeem(amount, minEth);
        await expect(tx)
          .to.emit(oethVault, "Redeem")
          .withNamedArgs({ _addr: matt.address });
      });
      it("OETH whale can not full redeem due to liquidity", async () => {
        const { oeth, oethVault } = fixture;

        const oethWhaleBalance = await oeth.balanceOf(oethWhaleAddress);
        expect(oethWhaleBalance, "no longer an OETH whale").to.gt(
          parseUnits("100", 18)
        );

        const tx = oethVault
          .connect(oethWhaleSigner)
          .redeem(oethWhaleBalance, 0);
        await expect(tx).to.revertedWith("Liquidity error");
      });
      it("OETH whale can redeem after withdraw from all strategies", async () => {
        const { oeth, oethVault, timelock } = fixture;

        const oethWhaleBalance = await oeth.balanceOf(oethWhaleAddress);
        expect(oethWhaleBalance, "no longer an OETH whale").to.gt(
          parseUnits("100", 18)
        );

        await oethVault.connect(timelock).withdrawAllFromStrategies();

        const tx = await oethVault
          .connect(oethWhaleSigner)
          .redeem(oethWhaleBalance, 0);
        await expect(tx)
          .to.emit(oethVault, "Redeem")
          .withNamedArgs({ _addr: oethWhaleAddress });
      });
      it("OETH whale redeem 100 OETH", async () => {
        const { oethVault } = fixture;

        const amount = parseUnits("100", 18);
        const minEth = parseUnits("99.4", 18);

        const tx = await oethVault
          .connect(oethWhaleSigner)
          .redeem(amount, minEth);
        await expect(tx)
          .to.emit(oethVault, "Redeem")
          .withNamedArgs({ _addr: oethWhaleAddress });
      });
    });
  });
});
