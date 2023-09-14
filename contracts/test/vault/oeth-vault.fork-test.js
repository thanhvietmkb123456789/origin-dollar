const { expect } = require("chai");
const { formatUnits, parseUnits } = require("ethers/lib/utils");

const addresses = require("../../utils/addresses");
const { resolveAsset } = require("../../utils/assets");
const {
  createFixtureLoader,
  oethDefaultFixture,
  impersonateAccount,
} = require("../_fixture");
const { forkOnlyDescribe, isCI } = require("../helpers");

const log = require("../../utils/logger")("test:fork:oeth:vault");

const { oethWhaleAddress } = addresses.mainnet;

forkOnlyDescribe("ForkTest: OETH Vault", function () {
  this.timeout(0);

  // Retry up to 3 times on CI
  this.retries(isCI ? 3 : 0);

  let fixture;
  const loadFixture = createFixtureLoader(oethDefaultFixture);
  beforeEach(async () => {
    fixture = await loadFixture();
  });

  describe("OETH Vault", () => {
    describe("post deployment", () => {
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
    describe("Oracle prices", () => {
      const assetPriceRanges = {
        WETH: {
          min: parseUnits("1"),
          max: parseUnits("1"),
        },
        stETH: {
          min: parseUnits("0.99"),
          max: parseUnits("1"),
        },
        rETH: {
          min: parseUnits("1.08"),
          max: parseUnits("1.1"),
        },
        frxETH: {
          min: parseUnits("0.985"),
          max: parseUnits("1"),
        },
      };
      for (const [symbol, { min, max }] of Object.entries(assetPriceRanges)) {
        it(`Should return a price for minting with ${symbol}`, async () => {
          const { oethVault, oethOracleRouter } = fixture;

          const asset = await resolveAsset(symbol);

          const oraclePrice = await oethOracleRouter.price(asset.address);
          if (oraclePrice.gt(parseUnits("0.998"))) {
            const price = await oethVault.priceUnitMint(asset.address);

            log(`Price for minting with ${symbol}: ${formatUnits(price, 18)}`);

            expect(price).to.be.gte(min);
            expect(price).to.be.lte(max);
          } else {
            const tx = oethVault.priceUnitMint(asset.address);
            await expect(tx).to.revertedWith("Asset price below peg");
          }
        });
        it(`Should return a price for redeeming with ${symbol}`, async () => {
          const { oethVault } = fixture;

          const asset = await resolveAsset(symbol);
          const price = await oethVault.priceUnitRedeem(asset.address);

          log(`Price for redeeming with ${symbol}: ${formatUnits(price, 18)}`);

          expect(price).to.be.gte(min);
          expect(price).to.be.lte(max);
        });
      }
      it("Should return OETH floor price", async () => {
        const { oethVault, josh } = fixture;

        const price = await oethVault.floorPrice();
        log(`OETH price: ${formatUnits(price, 18)}`);

        const price2 = await oethVault.floorPrice2();
        log(`OETH price2: ${formatUnits(price2, 18)}`);

        expect(price).to.be.gte(parseUnits("0.99"));
        expect(price).to.be.lte(parseUnits("1"));

        // This uses a transaction to call a view function so the gas usage can be reported.
        const tx = await oethVault
          .connect(josh)
          .populateTransaction.floorPrice();
        await josh.sendTransaction(tx);
      });
    });
    describe("user operations", () => {
      let oethWhaleSigner;
      beforeEach(async () => {
        await impersonateAccount(oethWhaleAddress);
        oethWhaleSigner = await ethers.provider.getSigner(oethWhaleAddress);
      });

      it("should mint using each asset", async () => {
        const { oethVault, oethOracleRouter, weth, frxETH, stETH, reth, josh } =
          fixture;

        const amount = parseUnits("1", 18);
        const minOeth = parseUnits("0.8", 18);

        for (const asset of [weth, frxETH, stETH, reth]) {
          await asset.connect(josh).approve(oethVault.address, amount);

          const price = await oethOracleRouter.price(asset.address);
          if (price.gt(parseUnits("0.998"))) {
            const tx = await oethVault
              .connect(josh)
              .mint(asset.address, amount, minOeth);

            if (asset === weth) {
              await expect(tx)
                .to.emit(oethVault, "Mint")
                .withArgs(josh.address, amount);
            } else {
              // Oracle price means 1 asset != 1 OETH
              await expect(tx)
                .to.emit(oethVault, "Mint")
                .withNamedArgs({ _addr: josh.address });
            }
          } else {
            const tx = oethVault
              .connect(josh)
              .mint(asset.address, amount, minOeth);
            await expect(tx).to.revertedWith("Asset price below peg");
          }
        }
      });
      it("should partially redeem", async () => {
        const { oeth, oethVault } = fixture;

        expect(await oeth.balanceOf(oethWhaleAddress)).to.gt(10);

        const amount = parseUnits("10", 18);
        const minEth = parseUnits("9.94", 18);

        const tx = await oethVault
          .connect(oethWhaleSigner)
          .redeem(amount, minEth);
        await expect(tx)
          .to.emit(oethVault, "Redeem")
          .withNamedArgs({ _addr: oethWhaleAddress });
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
        log(`OETH whale balance: ${formatUnits(oethWhaleBalance)}`);
        expect(oethWhaleBalance, "no longer an OETH whale").to.gt(
          parseUnits("1000", 18)
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
