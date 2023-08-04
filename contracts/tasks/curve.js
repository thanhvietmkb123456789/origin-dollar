const { formatUnits, parseUnits } = require("ethers/lib/utils");
const { BigNumber } = require("ethers");

const ousdPoolAbi = require("../test/abi/ousdMetapool.json");
const oethPoolAbi = require("../test/abi/oethMetapool.json");
const addresses = require("../utils/addresses");
const { resolveAsset } = require("../utils/assets");
const { getDiffBlocks } = require("./block");
const { getSigner } = require("../utils/signers");
const { scaleAmount } = require("../utils/units");

const log = require("../utils/logger")("task:curve");

/**
 * Hardhat task to dump the current state of a Curve Metapool pool used for AMO
 */
async function curvePoolTask(taskArguments, hre) {
  const poolOTokenSymbol = taskArguments.pool;

  const output = taskArguments.output ? console.log : log;

  const { blockTag, fromBlockTag, diffBlocks } = await getDiffBlocks(
    taskArguments,
    hre
  );

  await curvePool({
    poolOTokenSymbol,
    diffBlocks,
    blockTag,
    fromBlockTag,
    output,
  });
}

/**
 * Dumps the current state of a Curve Metapool pool used for AMO
 */
async function curvePool({
  poolOTokenSymbol,
  diffBlocks = false,
  blockTag,
  fromBlockTag,
  output = console.log,
}) {
  // Get symbols and contracts
  const { oTokenSymbol, assetSymbol, poolLPSymbol, pool } =
    await curveContracts(poolOTokenSymbol);

  // Get Metapool data
  const totalLPsBefore =
    diffBlocks && (await pool.totalSupply({ blockTag: fromBlockTag }));
  const totalLPs = await pool.totalSupply({ blockTag });
  const virtualPriceBefore =
    diffBlocks &&
    (await pool.get_virtual_price({
      blockTag: fromBlockTag,
    }));
  const virtualPrice = await pool.get_virtual_price({ blockTag });
  const invariant = virtualPrice.mul(totalLPs).div(parseUnits("1"));
  const invariantBefore =
    diffBlocks && virtualPriceBefore.mul(totalLPsBefore).div(parseUnits("1"));

  output(
    displayProperty(
      "Pool LP total supply",
      poolLPSymbol,
      totalLPs,
      totalLPsBefore,
      6
    )
  );

  output(displayProperty("Invariant (D) ", "", invariant, invariantBefore, 6));

  output(
    displayProperty(
      "LP virtual price",
      assetSymbol,
      virtualPrice,
      virtualPriceBefore,
      6
    )
  );

  // Pool balances
  const poolBalancesBefore =
    diffBlocks &&
    (await pool.get_balances({
      blockTag: fromBlockTag,
    }));
  const poolBalances = await pool.get_balances({ blockTag });

  // swap 1 OETH for ETH (OETH/ETH)
  const price1Before =
    diffBlocks &&
    (await pool["get_dy(int128,int128,uint256)"](1, 0, parseUnits("1"), {
      blockTag: fromBlockTag,
    }));
  const price1 = await pool["get_dy(int128,int128,uint256)"](
    1,
    0,
    parseUnits("1"),
    { blockTag }
  );

  output(
    displayProperty(
      `${oTokenSymbol} price`,
      `${oTokenSymbol}/${assetSymbol}`,
      price1,
      price1Before,
      6
    )
  );

  // swap 1 ETH for OETH (ETH/OETH)
  const price2Before =
    diffBlocks &&
    (await pool["get_dy(int128,int128,uint256)"](0, 1, parseUnits("1"), {
      blockTag: fromBlockTag,
    }));
  const price2 = await pool["get_dy(int128,int128,uint256)"](
    0,
    1,
    parseUnits("1"),
    { blockTag }
  );

  output(
    displayProperty(
      `${assetSymbol} price`,
      `${assetSymbol}/${oTokenSymbol}`,
      price2,
      price2Before,
      6
    )
  );

  // Total Metapool assets
  const totalBalances = poolBalances[0].add(poolBalances[1]);
  output(
    `total assets in pool     : ${displayPortion(
      poolBalances[0],
      totalBalances,
      assetSymbol,
      "pool",
      4
    )} ${displayDiff(diffBlocks, poolBalances[0], poolBalancesBefore[0])}`
  );
  output(
    `total OTokens in pool    : ${displayPortion(
      poolBalances[1],
      totalBalances,
      oTokenSymbol,
      "pool",
      4
    )} ${displayDiff(diffBlocks, poolBalances[1], poolBalancesBefore[1])}`
  );

  return {
    totalLPsBefore,
    totalLPs,
    poolBalancesBefore,
    poolBalances,
    totalBalances,
  };
}

/**
 * hardhat task that dumps the current state of a AMO Strategy
 */
async function amoStrategyTask(taskArguments, hre) {
  const poolOTokenSymbol = taskArguments.pool;

  const output = taskArguments.output ? console.log : log;

  const { blockTag, fromBlockTag, diffBlocks } = await getDiffBlocks(
    taskArguments,
    hre
  );

  const { totalLPsBefore, totalLPs, poolBalancesBefore, poolBalances } =
    await curvePool({
      poolOTokenSymbol,
      diffBlocks,
      blockTag,
      fromBlockTag,
      output,
    });

  // Get symbols and contracts
  const {
    oTokenSymbol,
    assetSymbol,
    poolLPSymbol,
    assets,
    oToken,
    cvxRewardPool,
    amoStrategy,
    vault,
  } = await curveContracts(poolOTokenSymbol);

  // Strategy's Metapool LPs in the Convex pool
  const vaultLPsBefore =
    diffBlocks &&
    (await cvxRewardPool.balanceOf(amoStrategy.address, {
      blockTag: fromBlockTag,
    }));
  const vaultLPs = await cvxRewardPool.balanceOf(amoStrategy.address, {
    blockTag,
  });
  // total vault value
  const vaultTotalValueBefore =
    diffBlocks && (await vault.totalValue({ blockTag: fromBlockTag }));
  const vaultTotalValue = await vault.totalValue({ blockTag });
  // Total supply of OTokens
  const oTokenSupplyBefore =
    diffBlocks && (await oToken.totalSupply({ blockTag: fromBlockTag }));
  const oTokenSupply = await oToken.totalSupply({ blockTag });
  // Assets in the pool
  const strategyAssetsInPoolBefore =
    diffBlocks && poolBalancesBefore[0].mul(vaultLPsBefore).div(totalLPsBefore);
  const strategyAssetsInPool = poolBalances[0].mul(vaultLPs).div(totalLPs);
  // OTokens in the pool
  const strategyOTokensInPoolBefore =
    diffBlocks && poolBalancesBefore[1].mul(vaultLPsBefore).div(totalLPsBefore);
  const strategyOTokensInPool = poolBalances[1].mul(vaultLPs).div(totalLPs);
  // Adjusted total vault value
  const vaultAdjustedTotalValueBefore =
    diffBlocks && vaultTotalValueBefore.sub(strategyOTokensInPoolBefore);
  const vaultAdjustedTotalValue = vaultTotalValue.sub(strategyOTokensInPool);
  // Adjusted total supply of OTokens
  const vaultAdjustedTotalSupplyBefore =
    diffBlocks && oTokenSupplyBefore.sub(strategyOTokensInPoolBefore);
  const vaultAdjustedTotalSupply = oTokenSupply.sub(strategyOTokensInPool);

  // Strategy's Metapool LPs in the Convex pool
  output(
    `\nvault Metapool LPs       : ${displayPortion(
      vaultLPs,
      totalLPs,
      poolLPSymbol,
      "total supply"
    )} ${displayDiff(diffBlocks, vaultLPs, vaultLPsBefore)}`
  );
  // Strategy's share of the assets in the pool
  output(
    `assets owned by strategy : ${displayPortion(
      strategyAssetsInPool,
      vaultAdjustedTotalValue,
      assetSymbol,
      "adjusted vault value"
    )} ${displayDiff(
      diffBlocks,
      strategyAssetsInPool,
      strategyAssetsInPoolBefore
    )}`
  );

  // Strategy's share of the oTokens in the pool
  output(
    `OTokens owned by strategy: ${displayPortion(
      strategyOTokensInPool,
      vaultAdjustedTotalValue,
      oTokenSymbol,
      "OToken supply"
    )} ${displayDiff(
      diffBlocks,
      strategyOTokensInPool,
      strategyOTokensInPoolBefore
    )}`
  );
  const stratTotalInPool = strategyAssetsInPool.add(strategyOTokensInPool);
  output(`both owned by strategy   : ${formatUnits(stratTotalInPool)}`);

  // Strategy asset values
  let totalStrategyAssetsValueBefore = BigNumber.from(0);
  let totalStrategyAssetsValue = BigNumber.from(0);
  for (const asset of assets) {
    const symbol = await asset.symbol();
    const strategyAssetsValueBefore =
      diffBlocks &&
      (await amoStrategy.checkBalance(asset.address, {
        blockTag: fromBlockTag,
      }));
    const strategyAssetsValueBeforeScaled =
      diffBlocks && (await scaleAmount(strategyAssetsValueBefore, asset));
    totalStrategyAssetsValueBefore =
      diffBlocks &&
      totalStrategyAssetsValueBefore.add(strategyAssetsValueBeforeScaled);
    const strategyAssetsValue = await amoStrategy.checkBalance(asset.address, {
      blockTag,
    });
    const strategyAssetsValueScaled = await scaleAmount(
      strategyAssetsValue,
      asset
    );
    totalStrategyAssetsValue = totalStrategyAssetsValue.add(
      strategyAssetsValueScaled
    );
    output(
      `strategy ${symbol.padEnd(4)} value      : ${displayPortion(
        strategyAssetsValueScaled,
        vaultTotalValue,
        symbol,
        "vault value"
      )} ${displayDiff(
        diffBlocks,
        strategyAssetsValueScaled,
        strategyAssetsValueBeforeScaled
      )}`
    );
  }
  output(
    `strategy total value     : ${displayPortion(
      totalStrategyAssetsValue,
      vaultTotalValue,
      assetSymbol,
      "vault value"
    )} ${displayDiff(
      diffBlocks,
      totalStrategyAssetsValue,
      totalStrategyAssetsValueBefore
    )}`
  );

  // Adjusted strategy value = strategy assets value - strategy OTokens
  // Assume all OETH owned by the strategy will be burned after withdrawing
  // so are just left with the assets backing circulating OETH
  const strategyAdjustedValueBefore =
    diffBlocks &&
    totalStrategyAssetsValueBefore.sub(strategyOTokensInPoolBefore);
  const strategyAdjustedValue = totalStrategyAssetsValue.sub(
    strategyOTokensInPool
  );
  output(
    `strategy adjusted value  : ${displayPortion(
      strategyAdjustedValue,
      vaultAdjustedTotalValue,
      assetSymbol,
      "adjusted vault value"
    )} ${displayDiff(
      diffBlocks,
      strategyAdjustedValue,
      strategyAdjustedValueBefore
    )}`
  );
  output(
    `owned - adjusted value   : ${displayRatio(
      strategyAssetsInPool,
      strategyAdjustedValue,
      strategyAssetsInPoolBefore,
      strategyAdjustedValueBefore
    )}`
  );

  for (const asset of assets) {
    const assetsInVaultBefore =
      diffBlocks &&
      (await asset.balanceOf(vault.address, {
        blockTag: fromBlockTag,
      }));
    const assetsInVaultBeforeScaled =
      diffBlocks && (await scaleAmount(assetsInVaultBefore, asset));
    const assetsInVault = await asset.balanceOf(vault.address, { blockTag });
    const assetsInVaultScaled = await scaleAmount(assetsInVault, asset);
    const symbol = await asset.symbol();
    output(
      displayProperty(
        `${symbol.padEnd(4)} in vault`,
        symbol,
        assetsInVaultScaled,
        assetsInVaultBeforeScaled
      )
    );
  }
  // Vault's total value v total supply
  output(
    displayProperty(
      "\nOToken total supply",
      oTokenSymbol,
      oTokenSupply,
      oTokenSupplyBefore
    )
  );
  output(
    displayProperty(
      "vault assets value",
      assetSymbol,
      totalStrategyAssetsValue,
      totalStrategyAssetsValueBefore
    )
  );
  output(
    `total value - supply     : ${displayRatio(
      totalStrategyAssetsValue,
      oTokenSupply,
      totalStrategyAssetsValueBefore,
      oTokenSupplyBefore
    )}`
  );
  // Adjusted total value v total supply
  output(
    displayProperty(
      "OToken adjust supply",
      oTokenSymbol,
      vaultAdjustedTotalSupply,
      vaultAdjustedTotalSupplyBefore
    )
  );
  output(
    displayProperty(
      "vault adjusted value",
      assetSymbol,
      vaultAdjustedTotalValue,
      vaultAdjustedTotalValueBefore
    )
  );
  output(
    `adjusted value - supply  : ${displayRatio(
      vaultAdjustedTotalValue,
      vaultAdjustedTotalSupply,
      vaultAdjustedTotalValueBefore,
      vaultAdjustedTotalSupplyBefore
    )}`
  );

  // Strategy's net minted and threshold
  const netMintedForStrategy = await vault.netOusdMintedForStrategy({
    blockTag,
  });
  const netMintedForStrategyThreshold =
    await vault.netOusdMintForStrategyThreshold({ blockTag });
  const netMintedForStrategyDiff =
    netMintedForStrategyThreshold.sub(netMintedForStrategy);

  output(
    displayProperty(
      "\nNet minted for strategy",
      assetSymbol,
      netMintedForStrategy
    )
  );
  output(
    displayProperty(
      "Net minted threshold",
      assetSymbol,
      netMintedForStrategyThreshold
    )
  );
  output(
    displayProperty(
      "Net minted for strat diff",
      assetSymbol,
      netMintedForStrategyDiff
    )
  );
}

function displayDiff(diffBlocks, newValue, oldValue, precision = 2) {
  if (!diffBlocks) return "";
  // Calculate the difference between the new and old value
  const diff = newValue.sub(oldValue);
  // Calculate the percentage difference if the old value is not zerp
  const diffPercentage =
    oldValue.gt(0) &&
    diff.mul(BigNumber.from(10).pow(2 + precision)).div(oldValue);
  // Only display the percentage difference if the old value is not zero
  const displayPercentage = diffPercentage
    ? ` ${formatUnits(diffPercentage, precision)}%`
    : "";
  // Return the formatted display string
  return `\t${diff.gt(0) ? "+" : ""}${formatUnits(
    newValue.sub(oldValue)
  )}${displayPercentage}`;
}

function displayProperty(
  desc,
  unitDesc,
  currentValue,
  oldValue = false,
  decimals
) {
  return `${desc.padEnd(25)}: ${formatUnits(
    currentValue
  )} ${unitDesc} ${displayDiff(
    oldValue != false,
    currentValue,
    oldValue,
    decimals
  )}`;
}

function displayPortion(amount, total, units, comparison, precision = 2) {
  const basisPoints = amount
    .mul(BigNumber.from(10).pow(2 + precision))
    .div(total);
  return `${formatUnits(amount)} ${units} ${formatUnits(
    basisPoints,
    precision
  )}%${comparison ? " of " + comparison : ""}`;
}

function displayRatio(a, b, aBefore, bBefore, precision = 6) {
  const diff = a.sub(b);
  const diffPercentage = a.gt(0)
    ? diff.mul(BigNumber.from(10).pow(2 + precision)).div(b)
    : BigNumber.from(0);

  let diffBeforeDisplay = "";
  if (aBefore && bBefore) {
    const diffBefore = aBefore && bBefore && aBefore.sub(bBefore);
    diffBeforeDisplay = displayDiff(aBefore, diff, diffBefore, precision);
  }
  return `${formatUnits(diff)} ${formatUnits(
    diffPercentage,
    precision
  )}% ${diffBeforeDisplay}`;
}

/************************************
    Curve functions that write
 ************************************/

async function curveAddTask(taskArguments) {
  const { assets, min, otokens, slippage, symbol } = taskArguments;

  // Get symbols and contracts
  const { assetSymbol, oTokenSymbol, oToken, pool, poolLPSymbol } =
    await curveContracts(symbol);

  const signer = await getSigner();
  const signerAddress = await signer.getAddress();

  const oTokenAmount = parseUnits(otokens.toString());
  const assetAmount = parseUnits(assets.toString());
  log(
    `Adding ${formatUnits(oTokenAmount)} ${oTokenSymbol} and ${formatUnits(
      assetAmount
    )} ${assetSymbol} to ${poolLPSymbol}`
  );

  const assetBalance = await hre.ethers.provider.getBalance(signerAddress);
  const oTokenBalance = await oToken.balanceOf(signerAddress);
  log(
    `Signer balances ${signerAddress}\n${formatUnits(
      assetBalance
    )} ${assetSymbol}`
  );
  log(`${formatUnits(oTokenBalance)} ${oTokenSymbol}`);

  let minLpTokens;
  if (min != undefined) {
    minLpTokens = parseUnits(min.toString());
  } else {
    const virtualPrice = await pool.get_virtual_price();
    // 3Crv = USD / virtual price
    const estimatedLpTokens = oTokenAmount.add(assetAmount).div(virtualPrice);
    const slippageScaled = slippage * 100;
    minLpTokens = estimatedLpTokens.mul(10000 - slippageScaled).div(10000);
  }
  log(`min LP tokens: ${formatUnits(minLpTokens)}`);

  if (oTokenAmount.gt(0)) {
    await oToken.connect(signer).approve(pool.address, oTokenAmount);
  }

  const override = oTokenSymbol === "OETH" ? { value: assetAmount } : {};
  // prettier-ignore
  const tx = await pool
    .connect(signer)["add_liquidity(uint256[2],uint256)"](
      [assetAmount, oTokenAmount],
      minLpTokens, override
    );

  // get event data
  const receipt = await tx.wait();
  log(`${receipt.events.length} events emitted`);
  const event = receipt.events?.find((e) => e.event === "AddLiquidity");
  log(`invariant ${formatUnits(event.args.invariant)}`);
  log(
    `fees ${formatUnits(event.args.fees[0])} ${assetSymbol} ${formatUnits(
      event.args.fees[1]
    )} ${oTokenSymbol}`
  );
  log(`token_supply ${formatUnits(event.args.token_supply)}`);
}

async function curveRemoveTask(taskArguments) {
  const { assets, otokens, slippage, symbol } = taskArguments;

  // Get symbols and contracts
  const { assetSymbol, oTokenSymbol, oToken, pool, poolLPSymbol } =
    await curveContracts(symbol);

  const signer = await getSigner();

  const oTokenAmount = parseUnits(otokens.toString());
  const assetAmount = parseUnits(assets.toString());
  log(
    `Adding ${formatUnits(oTokenAmount)} ${oTokenSymbol} and ${formatUnits(
      assetAmount
    )} ${assetSymbol} to ${poolLPSymbol}`
  );

  const virtualPrice = await pool.get_virtual_price();
  // 3Crv = USD / virtual price
  const estimatedLpTokens = oTokenAmount.add(assetAmount).div(virtualPrice);
  const slippageScaled = slippage * 100;
  const maxLpTokens = estimatedLpTokens.mul(10000 + slippageScaled).div(10000);
  console.log(`min LP tokens: ${formatUnits(maxLpTokens)}`);

  if (oTokenAmount.gt(0)) {
    await oToken.connect(signer).approve(pool.address, oTokenAmount);
  }

  const override = oTokenSymbol === "OETH" ? { value: assetAmount } : {};
  // prettier-ignore
  await pool
    .connect(signer)["remove_liquidity_imbalance(uint256[2],uint256)"](
      [assetAmount, oTokenAmount],
      maxLpTokens, override
    );

  // TODO get LPs burned
}

async function curveSwapTask(taskArguments) {
  const { amount, from, min, symbol } = taskArguments;

  // Get symbols and contracts
  const { pool } = await curveContracts(symbol);

  const signer = await getSigner();

  const fromAmount = parseUnits(from.toString());
  const minAmount = parseUnits(min.toString());
  log(`Swapping ${formatUnits(fromAmount)} ${from}`);

  const fromIndex = from === "ETH" || from === "3CRV" ? 0 : 1;
  const toIndex = from === "ETH" || from === "3CRV" ? 1 : 0;

  const override = from === "ETH" ? { value: amount } : {};
  // prettier-ignore
  await pool
    .connect(signer).exchange(
          fromIndex,
          toIndex,
          fromAmount,
          minAmount,
          override
    );

  // TODO get LPs burned
}

async function curveContracts(oTokenSymbol) {
  // Get symbols of tokens in the pool
  const assetSymbol = oTokenSymbol === "OETH" ? "ETH " : "USD";

  // Get the contract addresses
  const poolAddr =
    oTokenSymbol === "OETH"
      ? addresses.mainnet.CurveOETHMetaPool
      : addresses.mainnet.CurveOUSDMetaPool;
  const strategyAddr =
    oTokenSymbol === "OETH"
      ? addresses.mainnet.ConvexOETHAMOStrategy
      : addresses.mainnet.ConvexOUSDAMOStrategy;
  const convexRewardsPoolAddr =
    oTokenSymbol === "OETH"
      ? addresses.mainnet.CVXETHRewardsPool
      : addresses.mainnet.CVXRewardsPool;
  const poolLPSymbol = oTokenSymbol === "OETH" ? "OETHCRV-f" : "OUSD3CRV-f";
  const vaultAddr =
    oTokenSymbol === "OETH"
      ? addresses.mainnet.OETHVaultProxy
      : addresses.mainnet.VaultProxy;
  const oTokenAddr =
    oTokenSymbol === "OETH"
      ? addresses.mainnet.OETHProxy
      : addresses.mainnet.OUSDProxy;

  // Load all the contracts
  const assets =
    oTokenSymbol === "OETH"
      ? [await resolveAsset("WETH")]
      : [
          await resolveAsset("DAI"),
          await resolveAsset("USDC"),
          await resolveAsset("USDT"),
        ];
  const pool =
    oTokenSymbol === "OETH"
      ? await hre.ethers.getContractAt(oethPoolAbi, poolAddr)
      : await hre.ethers.getContractAt(ousdPoolAbi, poolAddr);
  const cvxRewardPool = await ethers.getContractAt(
    "IRewardStaking",
    convexRewardsPoolAddr
  );
  const amoStrategy = await ethers.getContractAt("IStrategy", strategyAddr);
  const oToken = await ethers.getContractAt("IERC20", oTokenAddr);
  const vault = await ethers.getContractAt("IVault", vaultAddr);

  return {
    oTokenSymbol,
    assetSymbol,
    poolLPSymbol,
    pool,
    cvxRewardPool,
    amoStrategy,
    oToken,
    assets,
    vault,
  };
}

module.exports = {
  amoStrategyTask,
  curvePoolTask,
  curveAddTask,
  curveRemoveTask,
  curveSwapTask,
};
