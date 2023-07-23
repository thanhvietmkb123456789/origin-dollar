// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title OETH Base Balancer Abstract Strategy
 * @author Origin Protocol Inc
 */
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20, InitializableAbstractStrategy } from "../../utils/InitializableAbstractStrategy.sol";
import { IBalancerVault } from "../../interfaces/balancer/IBalancerVault.sol";
import { IRateProvider } from "../../interfaces/balancer/IRateProvider.sol";
import { VaultReentrancyLib } from "./VaultReentrancyLib.sol";
import { IOracle } from "../../interfaces/IOracle.sol";
import { IVault } from "../../interfaces/IVault.sol";
import { IWstETH } from "../../interfaces/IWstETH.sol";
import { IERC4626 } from "../../../lib/openzeppelin/interfaces/IERC4626.sol";
import { StableMath } from "../../utils/StableMath.sol";
import "hardhat/console.sol";

abstract contract BaseBalancerStrategy is InitializableAbstractStrategy {
    using SafeERC20 for IERC20;
    using StableMath for uint256;
    IBalancerVault internal immutable balancerVault =
        IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    address internal immutable stEth =
        0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address internal immutable wstEth =
        0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address internal immutable frxEth =
        0x5E8422345238F34275888049021821E8E08CAa1f;
    address internal immutable sfrxEth =
        0xac3E018457B222d93114458476f3E3416Abbe38F;

    address internal pTokenAddress;
    bytes32 internal balancerPoolId;
    // Full list of all assets as they are present in the Balancer pool
    address[] internal poolAssetsMapped;
    // Max withdrawal slippage denominated in 1e18 (1e18 == 100%) - TODO better name also considered with deposits
    uint256 public maxWithdrawalSlippage;
    int256[50] private __reserved;

    event MaxWithdrawalSlippageUpdated(
        uint256 _prevMaxSlippagePercentage,
        uint256 _newMaxSlippagePercentage
    );

    /**
     * @dev Ensure we are not in a Vault context when this function is called, by attempting a no-op internal
     * balance operation. If we are already in a Vault transaction (e.g., a swap, join, or exit), the Vault's
     * reentrancy protection will cause this function to revert.
     *
     * Use this modifier with any function that can cause a state change in a pool and is either public itself,
     * or called by a public function *outside* a Vault operation (e.g., join, exit, or swap).
     */
    modifier whenNotInVaultContext() {
        VaultReentrancyLib.ensureNotInVaultContext(balancerVault);
        _;
    }

    /**
     * @dev Returns bool indicating whether asset is supported by strategy
     * @param _asset Address of the asset
     */
    function supportsAsset(address _asset)
        external
        view
        override
        returns (bool)
    {
        return assetToPToken[_asset] != address(0);
    }

    function checkBalance(address _asset)
        external
        view
        virtual
        override
        returns (uint256)
    {
        (IERC20[] memory tokens, uint256[] memory balances, ) = balancerVault
            .getPoolTokens(balancerPoolId);

        // yourPoolShare denominated in 1e18. (1e18 == 100%)
        uint256 yourPoolShare = IERC20(pTokenAddress)
            .balanceOf(address(this))
            .divPrecisely(IERC20(pTokenAddress).totalSupply());

        uint256 balancesLength = balances.length;
        for (uint256 i = 0; i < balancesLength; ++i) {
            (address poolAsset, ) = toPoolAsset(_asset, 0);

            if (address(tokens[i]) == poolAsset) {
                (, uint256 assetAmount) = fromPoolAsset(
                    poolAsset,
                    balances[i].mulTruncate(yourPoolShare)
                );
                return assetAmount;
            }
        }
    }

    function getBPTExpected(address _asset, uint256 _amount)
        internal
        view
        virtual
        returns (uint256 bptExpected)
    {
        /* BPT price is calculated by dividing the pool (sometimes wrapped) market price by the
         * rateProviderRate of that asset. To get BPT expected we need to multiply that by underlying
         * asset amount divided by BPT token rate. BPT token rate is similar to Curve's virtual_price
         * and expresses how much has the price of BPT appreciated in relation to the underlying assets.
         *
         * bptPrice = pool_asset_oracle_price / pool_asset_rate
         *
         * Since we only have oracle prices for the unwrapped version of the assets the equation
         * turns into:
         *
         * bptPrice = from_pool_token(asset_amount).amount * oracle_price / pool_asset_rate
         *
         * bptExpected = bptPrice(in relation to specified asset) * asset_amount / BPT_token_rate
         *
         * and since from_pool_token(asset_amount).amount and pool_asset_rate cancel each-other out
         * this makes the final equation:
         *
         * bptExpected = oracle_price * asset_amount / BPT_token_rate
         *
         * more explanation here:
         * https://www.notion.so/originprotocol/Support-Balancer-OETH-strategy-9becdea132704e588782a919d7d471eb?pvs=4#382834f9815e46a7937f3acca0f637c5
         */
        address priceProvider = IVault(vaultAddress).priceProvider();
        uint256 strategyAssetMarketPrice = IOracle(priceProvider).price(_asset);
        uint256 bptRate = IRateProvider(platformAddress).getRate();

        bptExpected = _amount
            .mulTruncate(strategyAssetMarketPrice)
            .divPrecisely(bptRate);
    }

    function getRateProviderRate(address _asset)
        internal
        view
        virtual
        returns (uint256);

    function _lpDepositAll() internal virtual;

    function _lpWithdraw(uint256 numBPTTokens) internal virtual;

    function _lpWithdrawAll() internal virtual;

    /**
     * Balancer returns assets and rateProviders for corresponding assets ordered
     * by numerical order.
     */
    function getPoolAssets() internal view returns (IERC20[] memory assets) {
        (IERC20[] memory tokens, , ) = balancerVault.getPoolTokens(
            balancerPoolId
        );
        return tokens;
    }

    /**
     * If an asset is rebasing the Balancer pools have a wrapped versions of assets
     * that the strategy supports. This function converts the pool(wrapped) asset
     * and corresponding amount to strategy asset.
     */
    function toPoolAsset(address asset, uint256 amount)
        internal
        view
        returns (address poolAsset, uint256 poolAmount)
    {
        poolAmount = 0;
        // if stEth
        if (asset == stEth) {
            // wstEth
            poolAsset = wstEth;
            if (amount > 0) {
                poolAmount = IWstETH(wstEth).getWstETHByStETH(amount);
            }
            // if frxEth
        } else if (asset == frxEth) {
            // sfrxEth
            poolAsset = sfrxEth;
            if (amount > 0) {
                poolAmount = IERC4626(sfrxEth).convertToShares(amount);
            }
        } else {
            poolAsset = asset;
            poolAmount = amount;
        }
    }

    /**
     * Converts rebasing asset to its wrapped counterpart.
     */
    function wrapPoolAsset(address asset, uint256 amount)
        internal
        returns (uint256 wrappedAmount)
    {
        // if stEth
        if (asset == stEth) {
            wrappedAmount = IWstETH(wstEth).wrap(amount);
            // if frxEth
        } else if (asset == frxEth) {
            wrappedAmount = IERC4626(sfrxEth).deposit(amount, address(this));
        } else {
            wrappedAmount = amount;
        }
    }

    /**
     * Converts wrapped asset to its rebasing counterpart.
     */
    function unwrapPoolAsset(address asset, uint256 amount)
        internal
        returns (uint256 wrappedAmount)
    {
        // if stEth
        if (asset == stEth) {
            wrappedAmount = IWstETH(wstEth).unwrap(amount);
            // if frxEth
        } else if (asset == frxEth) {
            wrappedAmount = IERC4626(sfrxEth).withdraw(
                amount,
                address(this),
                address(this)
            );
        } else {
            wrappedAmount = amount;
        }
    }

    /**
     * If an asset is rebasing the Balancer pools have a wrapped versions of assets
     * that the strategy supports. This function converts the rebasing strategy asset
     * and corresponding amount to wrapped(pool) asset.
     */
    function fromPoolAsset(address poolAsset, uint256 poolAmount)
        internal
        view
        returns (address asset, uint256 amount)
    {
        amount = 0;
        // if wstEth
        if (poolAsset == wstEth) {
            // stEth
            asset = stEth;
            if (poolAmount > 0) {
                amount = IWstETH(wstEth).getStETHByWstETH(poolAmount);
            }
            // if frxEth
        } else if (poolAsset == sfrxEth) {
            // sfrxEth
            asset = frxEth;
            if (poolAmount > 0) {
                amount = IERC4626(sfrxEth).convertToAssets(poolAmount);
            }
        } else {
            asset = poolAsset;
            amount = poolAmount;
        }
    }

    /**
     * @dev Sets max withdrawal slippage that is considered when removing
     * liquidity from Balancer pools.
     * @param _maxWithdrawalSlippage Max withdrawal slippage denominated in
     *        wad (number with 18 decimals): 1e18 == 100%, 1e16 == 1%
     *
     * IMPORTANT Minimum maxWithdrawalSlippage should actually be 0.1% (1e15)
     * for production usage. Contract allows as low value as 0% for confirming
     * correct behavior in test suite.
     */
    function setMaxWithdrawalSlippage(uint256 _maxWithdrawalSlippage)
        external
        onlyVaultOrGovernorOrStrategist
    {
        require(
            _maxWithdrawalSlippage <= 1e18,
            "Max withdrawal slippage needs to be between 0% - 100%"
        );
        emit MaxWithdrawalSlippageUpdated(
            maxWithdrawalSlippage,
            _maxWithdrawalSlippage
        );
        maxWithdrawalSlippage = _maxWithdrawalSlippage;
    }

    function _approveBase() internal virtual {
        IERC20 pToken = IERC20(pTokenAddress);
        // Balancer vault for BPT token (required for removing liquidity)
        pToken.safeApprove(address(balancerVault), 0);
        pToken.safeApprove(address(balancerVault), type(uint256).max);
    }
}
